// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IAssetToken } from "../interfaces/IAssetToken.sol";
import { IAssetVault } from "../interfaces/IAssetVault.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";

contract RedemptionController is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum RedemptionMode {
        Normal,
        Maturity,
        Emergency
    }

    IAssetToken public immutable assetToken;
    IAssetVault public immutable vault;
    IAssetRegistry public immutable registry;
    bytes32 public immutable assetId;
    uint64 public immutable periodDuration;
    uint256 public immutable periodLimitTokens;

    uint64 public periodStartedAt;
    uint256 public redeemedThisPeriod;
    uint256 public totalRedeemedTokens;
    uint256 public totalStablecoinPaid;
    uint256 public emergencySettlementPrice;

    event Redeemed(
        address indexed holder,
        RedemptionMode indexed mode,
        uint256 tokenAmount,
        uint256 stablecoinAmount,
        uint256 nav,
        uint256 redemptionPrice
    );
    event EmergencySettlementPriceSet(uint256 previousPrice, uint256 newPrice);
    event RedemptionPeriodReset(uint64 startedAt);

    error InvalidConfiguration();
    error InvalidMode();
    error InvalidAmount();
    error PeriodLimitExceeded();
    error InsufficientReserveLiquidity();
    error ZeroRedemptionValue();

    constructor(
        address assetToken_,
        address vault_,
        address registry_,
        bytes32 assetId_,
        uint64 periodDuration_,
        uint256 periodLimitTokens_,
        address admin
    ) {
        if (
            assetToken_ == address(0) || vault_ == address(0) || registry_ == address(0)
                || admin == address(0) || periodDuration_ == 0 || periodLimitTokens_ == 0
        ) revert InvalidConfiguration();
        assetToken = IAssetToken(assetToken_);
        vault = IAssetVault(vault_);
        registry = IAssetRegistry(registry_);
        assetId = assetId_;
        periodDuration = periodDuration_;
        periodLimitTokens = periodLimitTokens_;
        periodStartedAt = uint64(block.timestamp);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function redeem(uint256 tokenAmount, uint256 minimumStablecoinOut, RedemptionMode mode)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 stablecoinAmount)
    {
        if (tokenAmount == 0) revert InvalidAmount();
        _validateMode(mode);
        _rollPeriod();
        if (redeemedThisPeriod + tokenAmount > periodLimitTokens) revert PeriodLimitExceeded();

        (uint256 nav,) = registry.navOf(assetId);
        uint256 price = redemptionPrice(mode);
        if (price == 0) revert ZeroRedemptionValue();
        stablecoinAmount = DecimalMath.assetToStable(tokenAmount, price);
        if (stablecoinAmount < minimumStablecoinOut) revert InvalidAmount();
        if (stablecoinAmount > vault.availableRedemptionLiquidity()) {
            revert InsufficientReserveLiquidity();
        }

        redeemedThisPeriod += tokenAmount;
        totalRedeemedTokens += tokenAmount;
        totalStablecoinPaid += stablecoinAmount;

        // Burning first ensures token obligations fall before reserve liquidity is released.
        assetToken.burnForRedemption(msg.sender, tokenAmount);
        vault.releaseRedemption(msg.sender, stablecoinAmount);

        emit Redeemed(msg.sender, mode, tokenAmount, stablecoinAmount, nav, price);
    }

    /// @notice NAV is a reference; the redemption price is capped by liquid reserve backing.
    function redemptionPrice(RedemptionMode mode) public view returns (uint256) {
        (uint256 nav,) = registry.navOf(assetId);
        uint256 supply = assetToken.totalSupply();
        if (supply == 0) return 0;
        uint256 liquidBackingPerToken =
            Math.mulDiv(vault.availableRedemptionLiquidity(), 1e18, supply);
        uint256 referencePrice = mode == RedemptionMode.Emergency && emergencySettlementPrice != 0
            ? emergencySettlementPrice
            : nav;
        return Math.min(referencePrice, liquidBackingPerToken);
    }

    function setEmergencySettlementPrice(uint256 newPrice) external onlyRole(KEEPER_ROLE) {
        (uint256 nav,) = registry.navOf(assetId);
        if (newPrice > nav) revert InvalidAmount();
        uint256 previous = emergencySettlementPrice;
        emergencySettlementPrice = newPrice;
        emit EmergencySettlementPriceSet(previous, newPrice);
    }

    function outstandingTokenObligations() external view returns (uint256) {
        return assetToken.totalSupply();
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _validateMode(RedemptionMode mode) private view {
        IAssetRegistry.AssetStatus status = registry.statusOf(assetId);
        if (mode == RedemptionMode.Normal && status != IAssetRegistry.AssetStatus.Active) {
            revert InvalidMode();
        }
        if (mode == RedemptionMode.Maturity && status != IAssetRegistry.AssetStatus.Matured) {
            revert InvalidMode();
        }
        if (
            mode == RedemptionMode.Emergency && status != IAssetRegistry.AssetStatus.Defaulted
                && status != IAssetRegistry.AssetStatus.Suspended
        ) revert InvalidMode();
    }

    function _rollPeriod() private {
        if (block.timestamp >= periodStartedAt + periodDuration) {
            periodStartedAt = uint64(block.timestamp);
            redeemedThisPeriod = 0;
            emit RedemptionPeriodReset(periodStartedAt);
        }
    }
}
