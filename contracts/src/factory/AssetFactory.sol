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

    event PoolFactoryApprovalChanged(address indexed poolFactory, bool approved);
    event AssetSystemDeployed(
        bytes32 indexed assetId, address indexed issuer, Deployment deployment
    );

    error InvalidAddress();
    error InvalidConfiguration();
    error AssetNotApproved();
    error UnauthorizedIssuer();
    error UnapprovedPoolFactory();
    error AlreadyDeployed();

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

    function deployAssetSystem(DeploymentParams calldata params)
        external
        onlyRole(ISSUER_ROLE)
        returns (Deployment memory deployment)
    {
        if (deployments[params.assetId].token != address(0)) {
            revert AlreadyDeployed();
        }
        if (registry.statusOf(params.assetId) != IAssetRegistry.AssetStatus.Approved) {
            revert AssetNotApproved();
        }
        if (registry.issuerOf(params.assetId) != msg.sender) revert UnauthorizedIssuer();
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

        deployment = _deployComponents(params, msg.sender);
        _configureComponents(deployment, params.revenueDepositor, params.identityRegistry);
        deployments[params.assetId] = deployment;

        registry.setAssetContracts(
            params.assetId,
            IAssetRegistry.Contracts({
                token: deployment.token,
                vault: deployment.vault,
                offering: deployment.offering,
                marketManager: deployment.marketManager,
                revenueDistributor: deployment.revenueDistributor,
                redemptionController: deployment.redemptionController
            })
        );
        registry.activateAsset(params.assetId);

        _handoffAdministration(deployment);
        emit AssetSystemDeployed(params.assetId, msg.sender, deployment);
    }

    function _deployComponents(DeploymentParams calldata params, address issuer)
        private
        returns (Deployment memory deployment)
    {
        deployment.token = ITokenDeployer(componentDeployers.token)
            .deploy(
                params.tokenName,
                params.tokenSymbol,
                params.assetId,
                address(registry),
                params.maximumSupply,
                address(this)
            );
        deployment.vault = IVaultDeployer(componentDeployers.vault)
            .deploy(
                stablecoin,
                deployment.token,
                address(registry),
                params.assetId,
                issuer,
                params.minimumReserveRatioBps,
                address(this)
            );
        deployment.offering = IOfferingDeployer(componentDeployers.offering)
            .deploy(
                PrimaryOffering.OfferingConfig({
                stablecoin: stablecoin,
                assetToken: deployment.token,
                vault: deployment.vault,
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
        deployment.revenueDistributor = IRevenueDeployer(componentDeployers.revenue)
            .deploy(stablecoin, deployment.token, deployment.vault, params.operator, address(this));
        deployment.redemptionController = IRedemptionDeployer(componentDeployers.redemption)
            .deploy(
                deployment.token,
                deployment.vault,
                address(registry),
                params.assetId,
                params.redemptionPeriodDuration,
                params.redemptionPeriodLimitTokens,
                address(this)
            );
        deployment.pool = _getOrCreatePool(params, deployment.token);
        deployment.marketManager = IMarketDeployer(componentDeployers.market)
            .deploy(
                deployment.pool,
                deployment.token,
                stablecoin,
                deployment.vault,
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

    function _configureComponents(
        Deployment memory deployment,
        address revenueDepositor,
        address identityRegistry
    ) private {
        AssetToken token = AssetToken(deployment.token);
        AssetVault vault = AssetVault(deployment.vault);
        RevenueDistributor revenue = RevenueDistributor(deployment.revenueDistributor);

        token.grantRole(token.ISSUANCE_CONTROLLER_ROLE(), deployment.offering);
        token.grantRole(token.REDEMPTION_CONTROLLER_ROLE(), deployment.redemptionController);
        token.setRevenueDistributor(deployment.revenueDistributor);
        // Permissioned transfers: investors must be verified; the canonical pool and the market
        // manager are infrastructure inside the compliance perimeter, not investors.
        token.setIdentityRegistry(identityRegistry);
        token.setComplianceExempt(deployment.marketManager, true);
        token.setComplianceExempt(deployment.pool, true);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployment.offering);
        vault.grantRole(vault.ALLOCATOR_ROLE(), deployment.revenueDistributor);
        vault.grantRole(vault.REDEMPTION_CONTROLLER_ROLE(), deployment.redemptionController);
        vault.grantRole(vault.MARKET_MANAGER_ROLE(), deployment.marketManager);
        vault.grantRole(vault.REVENUE_DEPOSITOR_ROLE(), revenueDepositor);
        revenue.grantRole(revenue.REVENUE_DEPOSITOR_ROLE(), revenueDepositor);
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

        token.renounceRole(token.DEFAULT_ADMIN_ROLE(), address(this));
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), address(this));
        offering.renounceRole(offering.DEFAULT_ADMIN_ROLE(), address(this));
        revenue.renounceRole(revenue.DEFAULT_ADMIN_ROLE(), address(this));
        redemption.renounceRole(redemption.DEFAULT_ADMIN_ROLE(), address(this));
        market.renounceRole(market.DEFAULT_ADMIN_ROLE(), address(this));
    }
}
