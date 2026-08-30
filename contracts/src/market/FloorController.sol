// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IAssetVault } from "../interfaces/IAssetVault.sol";
import { IFloorController } from "../interfaces/IFloorController.sol";
import { TickPriceMath } from "../libraries/TickPriceMath.sol";

/// @title FloorController
/// @notice The published protected-floor reference (D-025): a pool tick that ratchets upward one
///         `tickSpacing` at a time, never above `min(NAV, backing)` at the moment it moves.
///
/// @dev    This is a **reference, not a bid** (D-010). It does not change what `redeem()` pays -
///         redemption keeps paying the continuous `min(NAV, backing)`, which is always at or above
///         the published level. What the level drives is the UI's protected-floor figure and the
///         ARC engine's market-floor range, which a keeper repositions just below it.
///
///         The ratchet is safe because backing is non-decreasing while an asset is Active: a
///         redemption pays at most `currentBacking` per token, so it can only raise backing for the
///         holders who stay. That property is asserted in the invariant suite.
contract FloorController is AccessControl, IFloorController {
    /// @notice Anyone may advance the level; the guards are the ceiling and the cooldown, not the
    ///         caller. Kept as a role only for pausing-style administration of the cooldown.
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    IAssetVault public immutable vault;
    IAssetRegistry public immutable registry;
    bytes32 public immutable assetId;

    /// @notice Token ordering in the canonical pool. When the asset is token0 a higher tick means a
    ///         higher price; when it is token1 the relationship inverts.
    bool public immutable assetIsToken0;
    int24 public immutable tickSpacing;

    int24 public floorTick;
    uint64 public floorLevelCooldown;
    uint64 public lastLevelUpAt;

    event FloorLevelUp(
        int24 previousTick, int24 newTick, uint256 floorPrice, uint256 backing, uint256 nav
    );
    event FloorLevelCooldownSet(uint64 cooldownSeconds);

    error InvalidAddress();
    error InvalidTick();
    error AssetNotActive();
    error CooldownActive();
    error FloorCeilingExceeded();

    constructor(
        address vault_,
        address registry_,
        bytes32 assetId_,
        bool assetIsToken0_,
        int24 tickSpacing_,
        int24 initialFloorTick,
        uint64 floorLevelCooldown_,
        address admin
    ) {
        if (vault_ == address(0) || registry_ == address(0) || admin == address(0)) {
            revert InvalidAddress();
        }
        if (tickSpacing_ <= 0) revert InvalidTick();
        vault = IAssetVault(vault_);
        registry = IAssetRegistry(registry_);
        assetId = assetId_;
        assetIsToken0 = assetIsToken0_;
        tickSpacing = tickSpacing_;
        floorLevelCooldown = floorLevelCooldown_;

        // The initial level is not ceiling-checked: at deployment there is usually no investor
        // supply, so backing is undefined and every candidate would fail. It must be set at or
        // below the settlement floor by whoever deploys, and it can only rise from there.
        if (
            initialFloorTick % tickSpacing_ != 0 || initialFloorTick < TickPriceMath.MIN_TICK
                || initialFloorTick > TickPriceMath.MAX_TICK
        ) revert InvalidTick();
        floorTick = initialFloorTick;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Level-up
    // ---------------------------------------------------------------------

    /// @notice Advance the published floor by exactly one `tickSpacing` in the price-up direction.
    /// @dev    Permissionless by design: the conditions are objective and anyone verifying them
    ///         on-chain is doing the protocol a favour. One step per call, so a large reserve
    ///         inflow becomes a paced climb rather than a gap.
    ///
    ///         The ceiling is re-derived on every call rather than trusting the stored level, so
    ///         the ratchet is correct by construction rather than by assumption.
    function levelUp() external returns (int24 newTick) {
        if (registry.statusOf(assetId) != IAssetRegistry.AssetStatus.Active) {
            revert AssetNotActive();
        }
        if (lastLevelUpAt != 0 && block.timestamp < uint256(lastLevelUpAt) + floorLevelCooldown) {
            revert CooldownActive();
        }

        int24 previousTick = floorTick;
        newTick = nextTick();
        uint256 candidatePrice = priceAtTick(newTick);
        (uint256 nav, uint256 backing, uint256 ceiling) = ceilingParts();
        if (candidatePrice > ceiling) revert FloorCeilingExceeded();

        floorTick = newTick;
        lastLevelUpAt = uint64(block.timestamp);
        emit FloorLevelUp(previousTick, newTick, candidatePrice, backing, nav);
    }

    /// @notice True when `levelUp()` would succeed right now. Cheaper for a keeper than a
    ///         simulated call and used by the UI to show whether the floor is ready to move.
    function canLevelUp() external view returns (bool) {
        if (registry.statusOf(assetId) != IAssetRegistry.AssetStatus.Active) return false;
        if (lastLevelUpAt != 0 && block.timestamp < uint256(lastLevelUpAt) + floorLevelCooldown) {
            return false;
        }
        (,, uint256 ceiling) = ceilingParts();
        return priceAtTick(nextTick()) <= ceiling;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The next candidate level: one `tickSpacing` in the price-up direction.
    function nextTick() public view returns (int24) {
        return assetIsToken0 ? floorTick + tickSpacing : floorTick - tickSpacing;
    }

    /// @notice Price at `tick` in 6-decimal mUSD per whole asset token. Same conversion the market
    ///         manager applies to `slot0`, so the two are directly comparable.
    function priceAtTick(int24 tick) public view returns (uint256) {
        uint256 sqrtPriceX96 = uint256(TickPriceMath.getSqrtRatioAtTick(tick));
        uint256 q96 = 1 << 96;
        uint256 rawRatioX96 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, q96);
        if (rawRatioX96 == 0) return 0;
        return
            assetIsToken0
                ? Math.mulDiv(rawRatioX96, 1e18, q96)
                : Math.mulDiv(1e18, q96, rawRatioX96);
    }

    function floorPrice() public view returns (uint256) {
        return priceAtTick(floorTick);
    }

    /// @notice The level-up ceiling and its two inputs, all 6-decimal.
    function ceilingParts() public view returns (uint256 nav, uint256 backing, uint256 ceiling) {
        (nav,) = registry.navOf(assetId);
        backing = vault.currentBacking();
        ceiling = Math.min(nav, backing);
    }

    /// @notice True when the published floor is still at or below `min(NAV, backing)`.
    /// @dev    This can be **false without the floor having moved**. `floorPrice <= backing` holds
    ///         permanently, because the level only rises when it is at or below backing and backing
    ///         never falls while Active. `floorPrice <= NAV` is only guaranteed at the moment of
    ///         each level-up: a NAV markdown can leave a previously valid level above the new NAV.
    ///
    ///         D-025 answers that by pausing level-ups rather than lowering the published floor -
    ///         the ratchet would be worthless if it could retreat. The honest handling is to
    ///         surface the uncovered state, which is what this view is for: a UI must not keep
    ///         presenting the level as backed when this returns false.
    function isFloorCovered() external view returns (bool) {
        (,, uint256 ceiling) = ceilingParts();
        return floorPrice() <= ceiling;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Adjust the pacing between level-ups. There is deliberately no setter for
    ///         `floorTick`: a published floor that an admin can lower is not a ratchet.
    function setFloorLevelCooldown(uint64 cooldownSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        floorLevelCooldown = cooldownSeconds;
        emit FloorLevelCooldownSet(cooldownSeconds);
    }
}
