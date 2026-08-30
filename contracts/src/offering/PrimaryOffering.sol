// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IAssetToken } from "../interfaces/IAssetToken.sol";
import { IAssetVault } from "../interfaces/IAssetVault.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";
import { IIdentityRegistry } from "../compliance/IIdentityRegistry.sol";

contract PrimaryOffering is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Capitalisation at settlement (D-023): 65% issuer proceeds, 30% protected reserve,
    ///         5% market allocation. The 30% holdback is the reserve's starting balance and the
    ///         first point on the sinking-fund schedule; the issuer's fresh capital is the 65%.
    uint16 public constant ISSUER_BPS = 6_500;
    uint16 public constant RESERVE_BPS = 3_000;
    uint16 public constant MARKET_BPS = 500;

    struct OfferingConfig {
        address stablecoin;
        address assetToken;
        address vault;
        address registry;
        bytes32 assetId;
        uint64 startsAt;
        uint64 endsAt;
        uint256 tokenPrice;
        uint256 fundraisingCap;
        uint256 walletPurchaseLimit;
        uint256 inventoryCap;
        uint256 minimumPurchase;
        address admin;
    }

    IERC20 public immutable stablecoin;
    IAssetToken public immutable assetToken;
    IAssetVault public immutable vault;
    IAssetRegistry public immutable registry;
    bytes32 public immutable assetId;

    uint64 public immutable startsAt;
    uint64 public immutable endsAt;
    uint256 public immutable tokenPrice;
    uint256 public immutable fundraisingCap;
    uint256 public immutable walletPurchaseLimit;
    uint256 public immutable inventoryCap;
    uint256 public immutable minimumPurchase;

    uint256 public stablecoinRaised;
    uint256 public tokensSold;
    mapping(address => uint256) public purchasedByWallet;

    /// @notice Per-investor-class subscription limits (D-028). `investorClass` comes from the
    ///         protocol identity registry: 1 retail, 2 accredited, 3 institutional.
    /// @dev    `configured == false` falls back to the global `walletPurchaseLimit`, so adding the
    ///         mechanism changes nothing until a class is deliberately configured.
    struct ClassLimit {
        /// @dev Per-wallet subscription cap for this class. `type(uint256).max` expresses
        ///      "uncapped within the fundraising cap", which is what D-028 grants institutions.
        uint256 walletLimit;
        /// @dev Maximum share of the whole raise this class may take. Zero means no aggregate cap.
        uint256 aggregateCap;
        bool configured;
    }

    mapping(uint8 => ClassLimit) public classLimits;
    mapping(uint8 => uint256) public raisedByClass;

    event ClassLimitSet(uint8 indexed investorClass, uint256 walletLimit, uint256 aggregateCap);
    event TokensPurchased(
        address indexed buyer,
        uint256 stablecoinAmount,
        uint256 tokenAmount,
        uint256 issuerShare,
        uint256 reserveShare,
        uint256 marketShare
    );

    error InvalidConfiguration();
    error OfferingNotOpen();
    error AssetNotActive();
    error PurchaseTooSmall();
    error FundraisingCapExceeded();
    error WalletLimitExceeded();
    error InventoryExceeded();
    error ZeroTokenOutput();
    error ClassWalletLimitExceeded();
    error ClassAggregateCapExceeded();

    constructor(OfferingConfig memory config) {
        if (
            config.stablecoin == address(0) || config.assetToken == address(0)
                || config.vault == address(0) || config.registry == address(0)
                || config.admin == address(0) || config.startsAt >= config.endsAt
                || config.tokenPrice == 0 || config.fundraisingCap == 0
                || config.walletPurchaseLimit == 0 || config.inventoryCap == 0
                || config.minimumPurchase == 0 || ISSUER_BPS + RESERVE_BPS + MARKET_BPS != 10_000
        ) revert InvalidConfiguration();
        stablecoin = IERC20(config.stablecoin);
        assetToken = IAssetToken(config.assetToken);
        vault = IAssetVault(config.vault);
        registry = IAssetRegistry(config.registry);
        assetId = config.assetId;
        startsAt = config.startsAt;
        endsAt = config.endsAt;
        tokenPrice = config.tokenPrice;
        fundraisingCap = config.fundraisingCap;
        walletPurchaseLimit = config.walletPurchaseLimit;
        inventoryCap = config.inventoryCap;
        minimumPurchase = config.minimumPurchase;
        _grantRole(DEFAULT_ADMIN_ROLE, config.admin);
        _grantRole(PAUSER_ROLE, config.admin);
    }

    function buy(uint256 stablecoinAmount, uint256 minimumTokensOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 tokenAmount)
    {
        if (block.timestamp < startsAt || block.timestamp > endsAt) {
            revert OfferingNotOpen();
        }
        if (!registry.canIssue(assetId)) revert AssetNotActive();
        if (stablecoinAmount < minimumPurchase) revert PurchaseTooSmall();
        if (stablecoinRaised + stablecoinAmount > fundraisingCap) revert FundraisingCapExceeded();
        _enforceWalletLimits(msg.sender, stablecoinAmount);

        tokenAmount = DecimalMath.stableToAsset(stablecoinAmount, tokenPrice);
        if (tokenAmount == 0 || tokenAmount < minimumTokensOut) revert ZeroTokenOutput();
        if (tokensSold + tokenAmount > inventoryCap) revert InventoryExceeded();

        stablecoinRaised += stablecoinAmount;
        tokensSold += tokenAmount;
        purchasedByWallet[msg.sender] += stablecoinAmount;
        raisedByClass[investorClassOf(msg.sender)] += stablecoinAmount;

        uint256 issuerShare = DecimalMath.applyBps(stablecoinAmount, ISSUER_BPS);
        uint256 reserveShare = DecimalMath.applyBps(stablecoinAmount, RESERVE_BPS);
        uint256 marketShare = stablecoinAmount - issuerShare - reserveShare;

        stablecoin.safeTransferFrom(msg.sender, address(vault), stablecoinAmount);
        vault.recordPrimaryProceeds(issuerShare, reserveShare, marketShare);
        assetToken.mint(msg.sender, tokenAmount);

        emit TokensPurchased(
            msg.sender, stablecoinAmount, tokenAmount, issuerShare, reserveShare, marketShare
        );
    }

    /// @notice Set the subscription limits for one investor class (D-028).
    /// @param  walletLimit Per-wallet cap; `type(uint256).max` for uncapped within the raise.
    /// @param  aggregateCap Maximum share of the whole raise from this class; 0 for none.
    function setClassLimit(uint8 investorClass, uint256 walletLimit, uint256 aggregateCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        classLimits[investorClass] = ClassLimit({
            walletLimit: walletLimit, aggregateCap: aggregateCap, configured: true
        });
        emit ClassLimitSet(investorClass, walletLimit, aggregateCap);
    }

    /// @notice The buyer's class as recorded in the protocol identity registry, or 0 when the token
    ///         has no registry bound. An unregistered wallet reads 0 and falls back to the global
    ///         limit - it cannot receive tokens anyway, because the mint leg checks verification.
    function investorClassOf(address buyer) public view returns (uint8) {
        address identityRegistry = assetToken.identityRegistry();
        if (identityRegistry == address(0)) return 0;
        return IIdentityRegistry(identityRegistry).investorClass(buyer);
    }

    /// @notice The per-wallet cap that applies to `buyer`, after class fallback.
    function effectiveWalletLimit(address buyer) public view returns (uint256) {
        ClassLimit memory limit = classLimits[investorClassOf(buyer)];
        return limit.configured ? limit.walletLimit : walletPurchaseLimit;
    }

    /// @notice How much `buyer` may still subscribe, accounting for every cap that applies to them:
    ///         their effective per-wallet limit, their class's aggregate cap, and what is left of
    ///         the raise. This is the number a UI should show, not `walletPurchaseLimit`.
    function remainingAllowance(address buyer) external view returns (uint256) {
        uint8 investorClass = investorClassOf(buyer);
        ClassLimit memory limit = classLimits[investorClass];
        uint256 spent = purchasedByWallet[buyer];

        uint256 walletCap = limit.configured ? limit.walletLimit : walletPurchaseLimit;
        uint256 remaining = walletCap > spent ? walletCap - spent : 0;

        if (limit.configured && limit.aggregateCap != 0) {
            uint256 classRaised = raisedByClass[investorClass];
            uint256 classRemaining =
                limit.aggregateCap > classRaised ? limit.aggregateCap - classRaised : 0;
            if (classRemaining < remaining) remaining = classRemaining;
        }

        uint256 raiseRemaining =
            fundraisingCap > stablecoinRaised ? fundraisingCap - stablecoinRaised : 0;
        return raiseRemaining < remaining ? raiseRemaining : remaining;
    }

    /// @dev A configured class limit **replaces** the global `walletPurchaseLimit` rather than
    ///      stacking with it (D-028: "falling back to `walletPurchaseLimit`"). Stacking would cap
    ///      an institution at the retail-era global limit, which is the opposite of the intent.
    ///      The fundraising cap still bounds everyone, so "uncapped" means uncapped within the raise.
    function _enforceWalletLimits(address buyer, uint256 stablecoinAmount) private view {
        uint8 investorClass = investorClassOf(buyer);
        ClassLimit memory limit = classLimits[investorClass];
        uint256 spent = purchasedByWallet[buyer];

        if (limit.configured) {
            if (spent + stablecoinAmount > limit.walletLimit) revert ClassWalletLimitExceeded();
            if (
                limit.aggregateCap != 0
                    && raisedByClass[investorClass] + stablecoinAmount > limit.aggregateCap
            ) revert ClassAggregateCapExceeded();
        } else if (spent + stablecoinAmount > walletPurchaseLimit) {
            revert WalletLimitExceeded();
        }
    }

    function availableTokenInventory() external view returns (uint256) {
        return inventoryCap - tokensSold;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
