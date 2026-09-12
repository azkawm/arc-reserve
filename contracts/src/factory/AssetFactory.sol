// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { AssetRegistry } from "../registry/AssetRegistry.sol";
import { AssetToken } from "../token/AssetToken.sol";
import { AssetVault } from "../vault/AssetVault.sol";
import { PrimaryOffering } from "../offering/PrimaryOffering.sol";
import { RevenueDistributor } from "../revenue/RevenueDistributor.sol";
import { RedemptionController } from "../redemption/RedemptionController.sol";
import { AssetMarketManager } from "../market/AssetMarketManager.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IUniswapV3Pool, IUniswapV3Factory } from "../interfaces/IUniswapV3Pool.sol";
import {
    ITokenDeployer,
    IVaultDeployer,
    IOfferingDeployer,
    IRevenueDeployer,
    IRedemptionDeployer,
    IMarketDeployer
} from "../interfaces/IComponentDeployers.sol";

/// @title  AssetFactory
/// @notice Deploys and wires one asset's six components, then hands administration to the protocol
///         admin and keeps nothing (D-032).
///
/// @dev    D-033: deployment is TWO transactions, not one. A single `deployAssetSystem` measured
///         18,424,318 gas against the canonical Uniswap factory and 15,294,153 against the mock —
///         over Base Sepolia's EIP-7825 per-transaction cap (2^24 = 16,777,216) and over Hedera's
///         15,000,000 cap respectively. No amount of tuning fits six component deployments plus a
///         pool creation under either ceiling, so the work is split at the pool boundary:
///
///           1. `beginAssetSystem`  - token, vault, offering, revenue distributor. Asset stays
///                                    `Approved`; nothing is live and the vault refuses deposits.
///           2. `completeAssetSystem` - redemption controller, pool, market manager, then
///                                    `setAssetContracts` + `activateAsset` + full role handoff.
///
///         Both phases re-check the D-026 terms hash, so the two transactions cannot describe two
///         different assets. Phase 2 is bound to the wallet that ran phase 1.
contract AssetFactory is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    struct DeploymentParams {
        bytes32 assetId;
        string tokenName;
        string tokenSymbol;
        uint256 maximumSupply;
        uint16 minimumReserveRatioBps;
        uint64 offeringStartsAt;
        uint64 offeringEndsAt;
        uint256 tokenPrice;
        uint256 fundraisingCap;
        uint256 walletPurchaseLimit;
        uint256 offeringInventory;
        uint256 minimumPurchase;
        uint64 redemptionPeriodDuration;
        uint256 redemptionPeriodLimitTokens;
        address operator;
        address revenueDepositor;
        address poolFactory;
        uint24 poolFee;
        uint160 initialSqrtPriceX96;
        address identityRegistry;
    }

    struct Deployment {
        address token;
        address vault;
        address offering;
        address marketManager;
        address revenueDistributor;
        address redemptionController;
        address pool;
    }

    /// @notice What phase 1 leaves behind: four live-but-inert components, the wallet allowed to
    ///         finish the job, and the terms hash both phases must agree on.
    struct PendingDeployment {
        address token;
        address vault;
        address offering;
        address revenueDistributor;
        address initiator;
        bytes32 termsHash;
    }

    struct ComponentDeployerSet {
        address token;
        address vault;
        address offering;
        address revenue;
        address redemption;
        address market;
    }

    AssetRegistry public immutable registry;
    address public immutable stablecoin;
    address public immutable protocolAdmin;
    ComponentDeployerSet public componentDeployers;
    mapping(address => bool) public approvedPoolFactories;
    mapping(bytes32 => Deployment) public deployments;
    mapping(bytes32 => PendingDeployment) public pendingDeployments;

    event PoolFactoryApprovalChanged(address indexed poolFactory, bool approved);
    event AssetSystemBegun(
        bytes32 indexed assetId,
        address indexed issuer,
        address token,
        address vault,
        address offering,
        address revenueDistributor
    );
    event AssetSystemAbandoned(bytes32 indexed assetId, address indexed caller);
    event AssetSystemDeployed(
        bytes32 indexed assetId, address indexed issuer, Deployment deployment
    );

    error InvalidAddress();
    error InvalidConfiguration();
    error AssetNotApproved();
    error UnauthorizedIssuer();
    error UnapprovedPoolFactory();
    error TermsMismatch();
    error AlreadyDeployed();
    error AlreadyBegun();
    error NotBegun();
    error AssetIdMismatch();

    constructor(
        address registry_,
        address stablecoin_,
        address protocolAdmin_,
        ComponentDeployerSet memory componentDeployers_
    ) {
        if (
            registry_ == address(0) || stablecoin_ == address(0) || protocolAdmin_ == address(0)
                || componentDeployers_.token == address(0)
                || componentDeployers_.vault == address(0)
                || componentDeployers_.offering == address(0)
                || componentDeployers_.revenue == address(0)
                || componentDeployers_.redemption == address(0)
                || componentDeployers_.market == address(0)
        ) {
            revert InvalidAddress();
        }
        registry = AssetRegistry(registry_);
        stablecoin = stablecoin_;
        protocolAdmin = protocolAdmin_;
        componentDeployers = componentDeployers_;
        _grantRole(DEFAULT_ADMIN_ROLE, protocolAdmin_);
        _grantRole(ISSUER_ROLE, protocolAdmin_);
    }

    function setApprovedPoolFactory(address poolFactory, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (poolFactory == address(0)) revert InvalidAddress();
        approvedPoolFactories[poolFactory] = approved;
        emit PoolFactoryApprovalChanged(poolFactory, approved);
    }

    // -----------------------------------------------------------------
    // Phase 1
    // -----------------------------------------------------------------

    /// @notice Deploy and wire the four components that do not need a pool (D-033 phase 1).
    /// @dev    The asset stays `Approved` and is NOT registered in the registry, so nothing here is
    ///         reachable through the normal lifecycle: the offering cannot sell (`canIssue` is
    ///         false until `activateAsset`), the distributor cannot deposit (no supply exists to
    ///         divide), and the vault refuses its three direct inflows while the asset is
    ///         `Approved`. The window is inert, not merely unused.
    function beginAssetSystem(DeploymentParams calldata params)
        external
        onlyRole(ISSUER_ROLE)
        returns (PendingDeployment memory pending)
    {
        if (deployments[params.assetId].token != address(0)) {
            revert AlreadyDeployed();
        }
        if (pendingDeployments[params.assetId].token != address(0)) revert AlreadyBegun();
        _validateParams(params);

        pending = _deployPhaseOne(params, msg.sender);
        pending.initiator = msg.sender;
        pending.termsHash = keccak256(abi.encode(params));
        pendingDeployments[params.assetId] = pending;

        _configurePhaseOne(pending, params.revenueDepositor, params.identityRegistry);

        emit AssetSystemBegun(
            params.assetId,
            msg.sender,
            pending.token,
            pending.vault,
            pending.offering,
            pending.revenueDistributor
        );
    }

    // -----------------------------------------------------------------
    // Phase 2
    // -----------------------------------------------------------------

    /// @notice Finish the deployment started by `beginAssetSystem` (D-033 phase 2).
    /// @dev    Re-checks the terms hash against the value phase 1 recorded, so the two transactions
    ///         cannot describe different systems even if the verifier re-approved in between.
    ///
    ///         Retryable: everything here is one atomic transaction, so a revert (out of gas, a
    ///         pool created underneath us, a transient RPC failure) leaves the phase-1 record
    ///         untouched and the call can simply be repeated. The assetId is never burned by a
    ///         failed attempt. `_getOrCreatePool` reuses a pool that already exists, so even a
    ///         third party front-running the creation does not wedge the retry.
    function completeAssetSystem(bytes32 assetId, DeploymentParams calldata params)
        external
        onlyRole(ISSUER_ROLE)
        returns (Deployment memory deployment)
    {
        PendingDeployment memory pending = pendingDeployments[assetId];
        if (pending.token == address(0)) revert NotBegun();
        // Bound to the wallet that ran phase 1, not merely to `registry.issuerOf`: the issuer of
        // record could otherwise hand a half-built system to a different key, or a re-assigned
        // issuer could adopt someone else's partial deployment.
        if (pending.initiator != msg.sender) revert UnauthorizedIssuer();
        if (params.assetId != assetId) revert AssetIdMismatch();
        if (keccak256(abi.encode(params)) != pending.termsHash) revert TermsMismatch();

        deployment = _deployPhaseTwo(pending, params);
        _configurePhaseTwo(deployment);

        delete pendingDeployments[assetId];
        deployments[assetId] = deployment;

        registry.setAssetContracts(
            assetId,
            IAssetRegistry.Contracts({
                token: deployment.token,
                vault: deployment.vault,
                offering: deployment.offering,
                marketManager: deployment.marketManager,
                revenueDistributor: deployment.revenueDistributor,
                redemptionController: deployment.redemptionController
            })
        );
        registry.activateAsset(assetId);

        _handoffAdministration(deployment);
        emit AssetSystemDeployed(assetId, msg.sender, deployment);
    }

    // -----------------------------------------------------------------
    // Abandon
    // -----------------------------------------------------------------

    /// @notice Give up on a half-built system and release the assetId (D-033).
    /// @dev    Callable by the wallet that ran phase 1 or by the factory admin. The four orphaned
    ///         components are left adminless on purpose: they hold no funds (the vault's inflows
    ///         are closed while the asset is `Approved`, and no supply was ever minted), and
    ///         leaving them permanently inert is safer than leaving a standing admin over a
    ///         contract nobody is tracking.
    ///
    ///         Deliberately has NO time limit. A TTL would either be short enough to race a slow
    ///         issuer into losing a half-paid deployment, or long enough to be useless; the pending
    ///         record costs nothing to hold, and the admin can always clear it.
    ///
    ///         Clearing the record here only frees the FACTORY. The registry still has the asset at
    ///         `Approved`; a registry admin closes it with `closeAsset`.
    function abandonAssetSystem(bytes32 assetId) external {
        PendingDeployment memory pending = pendingDeployments[assetId];
        if (pending.token == address(0)) revert NotBegun();
        if (pending.initiator != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedIssuer();
        }

        delete pendingDeployments[assetId];

        AssetToken token = AssetToken(pending.token);
        AssetVault vault = AssetVault(pending.vault);
        PrimaryOffering offering = PrimaryOffering(pending.offering);
        RevenueDistributor revenue = RevenueDistributor(pending.revenueDistributor);
        token.renounceRole(token.PAUSER_ROLE(), address(this));
        vault.renounceRole(vault.PAUSER_ROLE(), address(this));
        offering.renounceRole(offering.PAUSER_ROLE(), address(this));
        revenue.renounceRole(revenue.PAUSER_ROLE(), address(this));
        revenue.renounceRole(revenue.REVENUE_DEPOSITOR_ROLE(), address(this));
        // Admin last: the renouncements above are self-service, but keep the ordering identical to
        // `_handoffAdministration` so the two paths cannot drift.
        token.renounceRole(token.DEFAULT_ADMIN_ROLE(), address(this));
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        offering.renounceRole(offering.DEFAULT_ADMIN_ROLE(), address(this));
        revenue.renounceRole(revenue.DEFAULT_ADMIN_ROLE(), address(this));

        emit AssetSystemAbandoned(assetId, msg.sender);
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    /// @notice True while `assetId` has a phase-1 record waiting for `completeAssetSystem`.
    function isPending(bytes32 assetId) external view returns (bool) {
        return pendingDeployments[assetId].token != address(0);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /// @dev Every gate that used to sit at the top of `deployAssetSystem`. Runs in phase 1 only:
    ///      phase 2 re-checks the terms hash against the phase-1 record, which transitively
    ///      re-checks everything validated here.
    function _validateParams(DeploymentParams calldata params) private view {
        if (registry.statusOf(params.assetId) != IAssetRegistry.AssetStatus.Approved) {
            revert AssetNotApproved();
        }
        if (registry.issuerOf(params.assetId) != msg.sender) revert UnauthorizedIssuer();
        // D-026: what gets deployed must hash to what the verifier approved. `DeploymentParams` is
        // therefore the canonical term sheet, and the offchain legal pack references the same hash.
        if (keccak256(abi.encode(params)) != registry.termsHashOf(params.assetId)) {
            revert TermsMismatch();
        }
        (uint256 nav,) = registry.navOf(params.assetId);
        if (
            nav == 0 || registry.maturityOf(params.assetId) <= block.timestamp
                || params.maximumSupply == 0 || params.offeringInventory == 0
                || params.offeringInventory > params.maximumSupply
                || params.minimumReserveRatioBps == 0 || params.minimumReserveRatioBps > 10_000
                || params.offeringStartsAt >= params.offeringEndsAt || params.tokenPrice == 0
                || params.fundraisingCap == 0 || params.walletPurchaseLimit == 0
                || params.minimumPurchase == 0 || params.redemptionPeriodDuration == 0
                || params.redemptionPeriodLimitTokens == 0 || params.operator == address(0)
                || params.revenueDepositor == address(0) || params.initialSqrtPriceX96 == 0
                || params.identityRegistry == address(0)
        ) revert InvalidConfiguration();
        if (!approvedPoolFactories[params.poolFactory]) revert UnapprovedPoolFactory();
    }

    function _deployPhaseOne(DeploymentParams calldata params, address issuer)
        private
        returns (PendingDeployment memory pending)
    {
        pending.token = ITokenDeployer(componentDeployers.token)
            .deploy(
                params.tokenName,
                params.tokenSymbol,
                params.assetId,
                address(registry),
                params.maximumSupply,
                address(this)
            );
        pending.vault = IVaultDeployer(componentDeployers.vault)
            .deploy(
                stablecoin,
                pending.token,
                address(registry),
                params.assetId,
                issuer,
                params.minimumReserveRatioBps,
                address(this)
            );
        pending.offering = IOfferingDeployer(componentDeployers.offering)
            .deploy(
                PrimaryOffering.OfferingConfig({
                stablecoin: stablecoin,
                assetToken: pending.token,
                vault: pending.vault,
                registry: address(registry),
                assetId: params.assetId,
                startsAt: params.offeringStartsAt,
                endsAt: params.offeringEndsAt,
                tokenPrice: params.tokenPrice,
                fundraisingCap: params.fundraisingCap,
                walletPurchaseLimit: params.walletPurchaseLimit,
                inventoryCap: params.offeringInventory,
                minimumPurchase: params.minimumPurchase,
                admin: address(this)
            })
            );
        pending.revenueDistributor = IRevenueDeployer(componentDeployers.revenue)
            .deploy(stablecoin, pending.token, pending.vault, params.operator, address(this));
    }

    function _deployPhaseTwo(PendingDeployment memory pending, DeploymentParams calldata params)
        private
        returns (Deployment memory deployment)
    {
        deployment.token = pending.token;
        deployment.vault = pending.vault;
        deployment.offering = pending.offering;
        deployment.revenueDistributor = pending.revenueDistributor;

        deployment.redemptionController = IRedemptionDeployer(componentDeployers.redemption)
            .deploy(
                pending.token,
                pending.vault,
                address(registry),
                params.assetId,
                params.redemptionPeriodDuration,
                params.redemptionPeriodLimitTokens,
                address(this)
            );
        deployment.pool = _getOrCreatePool(params, pending.token);
        deployment.marketManager = IMarketDeployer(componentDeployers.market)
            .deploy(
                deployment.pool,
                pending.token,
                stablecoin,
                pending.vault,
                address(registry),
                params.assetId,
                address(this)
            );
    }

    function _getOrCreatePool(DeploymentParams calldata params, address token)
        private
        returns (address pool)
    {
        IUniswapV3Factory uniswapFactory = IUniswapV3Factory(params.poolFactory);
        pool = uniswapFactory.getPool(token, stablecoin, params.poolFee);
        if (pool == address(0)) {
            pool = uniswapFactory.createPool(token, stablecoin, params.poolFee);
            IUniswapV3Pool(pool).initialize(params.initialSqrtPriceX96);
        }
    }

    /// @dev Everything wireable without a redemption controller, pool or market manager.
    function _configurePhaseOne(
        PendingDeployment memory pending,
        address revenueDepositor,
        address identityRegistry
    ) private {
        AssetToken token = AssetToken(pending.token);
        AssetVault vault = AssetVault(pending.vault);
        RevenueDistributor revenue = RevenueDistributor(pending.revenueDistributor);

        token.grantRole(token.ISSUANCE_CONTROLLER_ROLE(), pending.offering);
        token.setRevenueDistributor(pending.revenueDistributor);
        // Permissioned transfers: investors must be verified. The market manager and pool are
        // exempted in phase 2, once they exist.
        token.setIdentityRegistry(identityRegistry);
        vault.grantRole(vault.ALLOCATOR_ROLE(), pending.offering);
        vault.grantRole(vault.ALLOCATOR_ROLE(), pending.revenueDistributor);
        vault.grantRole(vault.REVENUE_DEPOSITOR_ROLE(), revenueDepositor);
        revenue.grantRole(revenue.REVENUE_DEPOSITOR_ROLE(), revenueDepositor);
    }

    /// @dev The wiring that needs the phase-2 components.
    function _configurePhaseTwo(Deployment memory deployment) private {
        AssetToken token = AssetToken(deployment.token);
        AssetVault vault = AssetVault(deployment.vault);

        token.grantRole(token.REDEMPTION_CONTROLLER_ROLE(), deployment.redemptionController);
        // The canonical pool and the market manager are infrastructure inside the compliance
        // perimeter, not investors.
        token.setComplianceExempt(deployment.marketManager, true);
        token.setComplianceExempt(deployment.pool, true);
        vault.grantRole(vault.REDEMPTION_CONTROLLER_ROLE(), deployment.redemptionController);
        vault.grantRole(vault.MARKET_MANAGER_ROLE(), deployment.marketManager);
        RedemptionController(deployment.redemptionController)
            .grantRole(
                RedemptionController(deployment.redemptionController).KEEPER_ROLE(), protocolAdmin
            );
        AssetMarketManager(deployment.marketManager)
            .grantRole(AssetMarketManager(deployment.marketManager).KEEPER_ROLE(), protocolAdmin);
    }

    function _handoffAdministration(Deployment memory deployment) private {
        AssetToken token = AssetToken(deployment.token);
        AssetVault vault = AssetVault(deployment.vault);
        PrimaryOffering offering = PrimaryOffering(deployment.offering);
        RevenueDistributor revenue = RevenueDistributor(deployment.revenueDistributor);
        RedemptionController redemption = RedemptionController(deployment.redemptionController);
        AssetMarketManager market = AssetMarketManager(deployment.marketManager);
        token.grantRole(token.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        token.grantRole(token.PAUSER_ROLE(), protocolAdmin);
        token.grantRole(token.TRANSFER_AGENT_ROLE(), protocolAdmin);
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        vault.grantRole(vault.PAUSER_ROLE(), protocolAdmin);
        offering.grantRole(offering.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        offering.grantRole(offering.PAUSER_ROLE(), protocolAdmin);
        revenue.grantRole(revenue.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        revenue.grantRole(revenue.PAUSER_ROLE(), protocolAdmin);
        redemption.grantRole(redemption.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        redemption.grantRole(redemption.PAUSER_ROLE(), protocolAdmin);
        market.grantRole(market.DEFAULT_ADMIN_ROLE(), protocolAdmin);
        market.grantRole(market.PAUSER_ROLE(), protocolAdmin);

        // The factory is constructed as `admin` of every component so it can wire them, which
        // means each constructor also handed it PAUSER_ROLE, and KEEPER_ROLE / REVENUE_DEPOSITOR_ROLE
        // where those default to the admin. It has no function that uses any of them, so keeping
        // them is a standing privilege with no purpose over every series it ever deploys.
        // Renounce all of them, not just the admin role. `FactoryRoleHygiene.t.sol` asserts the
        // factory ends up holding nothing, and that nothing it gave up was left without a holder.
        token.renounceRole(token.PAUSER_ROLE(), address(this));
        vault.renounceRole(vault.PAUSER_ROLE(), address(this));
        offering.renounceRole(offering.PAUSER_ROLE(), address(this));
        revenue.renounceRole(revenue.PAUSER_ROLE(), address(this));
        revenue.renounceRole(revenue.REVENUE_DEPOSITOR_ROLE(), address(this));
        redemption.renounceRole(redemption.PAUSER_ROLE(), address(this));
        redemption.renounceRole(redemption.KEEPER_ROLE(), address(this));
        market.renounceRole(market.PAUSER_ROLE(), address(this));
        market.renounceRole(market.KEEPER_ROLE(), address(this));

        // Admin last: the grants above need it.
        token.renounceRole(token.DEFAULT_ADMIN_ROLE(), address(this));
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        offering.renounceRole(offering.DEFAULT_ADMIN_ROLE(), address(this));
        revenue.renounceRole(revenue.DEFAULT_ADMIN_ROLE(), address(this));
        redemption.renounceRole(redemption.DEFAULT_ADMIN_ROLE(), address(this));
        market.renounceRole(market.DEFAULT_ADMIN_ROLE(), address(this));
    }
}
