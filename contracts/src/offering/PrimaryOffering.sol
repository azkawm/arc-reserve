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

contract PrimaryOffering is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint16 public constant ISSUER_BPS = 7_000;
    uint16 public constant RESERVE_BPS = 2_000;
    uint16 public constant MARKET_BPS = 1_000;

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
        if (purchasedByWallet[msg.sender] + stablecoinAmount > walletPurchaseLimit) {
            revert WalletLimitExceeded();
        }

        tokenAmount = DecimalMath.stableToAsset(stablecoinAmount, tokenPrice);
        if (tokenAmount == 0 || tokenAmount < minimumTokensOut) revert ZeroTokenOutput();
        if (tokensSold + tokenAmount > inventoryCap) revert InventoryExceeded();

        stablecoinRaised += stablecoinAmount;
        tokensSold += tokenAmount;
        purchasedByWallet[msg.sender] += stablecoinAmount;

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
