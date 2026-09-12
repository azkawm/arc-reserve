// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";
import { FloorController } from "../../src/market/FloorController.sol";
import { IFloorController } from "../../src/interfaces/IFloorController.sol";
import { MockUniswapV3Pool } from "../../src/mocks/MockUniswapV3Pool.sol";

/// @dev A controller that fails, to prove a rebalance survives it. `levelUp` always reverts;
///      `canLevelUp` reverts only when asked to, so both try/catch arms are exercised.
contract HostileFloorController is IFloorController {
    bool private immutable _breakCanLevelUp;

    constructor(bool breakCanLevelUp) {
        _breakCanLevelUp = breakCanLevelUp;
    }

    function floorTick() external pure returns (int24) {
        return 0;
    }

    function floorPrice() external pure returns (uint256) {
        return 0;
    }

    function isFloorCovered() external pure returns (bool) {
        return true;
    }

    function canLevelUp() external view returns (bool) {
        if (_breakCanLevelUp) revert("CAN_LEVEL_UP_BOOM");
        return true;
    }

    function levelUp() external pure returns (int24) {
        revert("LEVEL_UP_BOOM");
    }
}

/// @notice D-036: the two behaviours that replaced the TWAP — `slide`/`sweep` taking their signal
///         from the anchor's own range, and the opportunistic floor level-up on the rebalance path.
contract MarketSignalAndFloorLevelUpTest is ArcReserveTestBase {
    function setUp() public override {
        super.setUp();
        _buy(alice, 20_000e6);
        _configurePositions();
    }

    // -----------------------------------------------------------------
    // The anchor-range signal, proven under BOTH token orderings
    // -----------------------------------------------------------------

    /// @dev Constructs a manager against a pool whose token order we choose outright, rather than
    ///      hoping addresses sort a particular way. Tick-direction logic is exactly where a
    ///      one-sided suite passes while the other chain inverts, and `assetIsToken0` is false on
    ///      Anvil and true on Base today — so both orderings are exercised deliberately.
    function _managerWithOrdering(bool assetFirst)
        private
        returns (AssetMarketManager manager, MockUniswapV3Pool orderedPool, int24 lo, int24 hi)
    {
        orderedPool = assetFirst
            ? new MockUniswapV3Pool(address(token), address(musd), 60)
            : new MockUniswapV3Pool(address(musd), address(token), 60);
        manager = new AssetMarketManager(
            address(orderedPool),
            address(token),
            address(musd),
            address(vault),
            address(registry),
            assetId,
            address(this)
        );
        assertEq(manager.assetIsToken0(), assetFirst, "ordering not as constructed");

        if (assetFirst) {
            lo = -276_600;
            hi = -276_000;
            manager.configureCorePositions(-278_400, -276_600, lo, hi);
        } else {
            lo = 276_000;
            hi = 276_600;
            manager.configureCorePositions(276_600, 278_400, lo, hi);
        }
        // Start at one mUSD, inside the anchor band, for either ordering.
        int24 oneDollar = assetFirst ? int24(-276_324) : int24(276_324);
        orderedPool.setOracleForTest(oneDollar, oneDollar);
    }

    /// @dev Price ABOVE the band in price terms. With the asset as token1 that is a LOWER tick.
    function _pinPriceAboveBand(MockUniswapV3Pool p, bool assetFirst, int24 lo, int24 hi) private {
        int24 tick = assetFirst ? hi + 120 : lo - 120;
        p.setOracleForTest(tick, tick);
    }

    function _pinPriceBelowBand(MockUniswapV3Pool p, bool assetFirst, int24 lo, int24 hi) private {
        int24 tick = assetFirst ? lo - 120 : hi + 120;
        p.setOracleForTest(tick, tick);
    }

    function _assertSignalHolds(bool assetFirst) private {
        (AssetMarketManager manager, MockUniswapV3Pool p, int24 lo, int24 hi) =
            _managerWithOrdering(assetFirst);

        // Inside the band: the position is working, so neither move is permitted.
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        manager.slide(lo + 60, hi + 60);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        manager.sweep(lo - 60, hi - 60);

        // Price left on the upside: slide is allowed, sweep is not.
        _pinPriceAboveBand(p, assetFirst, lo, hi);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        manager.sweep(lo - 60, hi - 60);
        manager.slide(lo + 60, hi + 60);
        (int24 newLo, int24 newHi,,) = manager.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLo, lo + 60, "slide did not move the anchor");
        assertEq(newHi, hi + 60);

        // Price left on the downside: sweep is allowed, slide is not.
        vm.warp(block.timestamp + 31 minutes); // clear the rebalance cooldown
        _pinPriceBelowBand(p, assetFirst, newLo, newHi);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        manager.slide(newLo + 60, newHi + 60);
        manager.sweep(newLo - 60, newHi - 60);
        (int24 finalLo,,,) = manager.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(finalLo, newLo - 60, "sweep did not move the anchor");
    }

    function test_anchorSignalWithAssetAsToken0() public {
        _assertSignalHolds(true);
    }

    /// @dev The mirror case. If the direction logic were written tick-naively rather than in price
    ///      terms, this is the test that would fail while the other passed.
    function test_anchorSignalWithAssetAsToken1() public {
        _assertSignalHolds(false);
    }

    function test_slideRequiresAConfiguredAnchor() public {
        MockUniswapV3Pool bare = new MockUniswapV3Pool(address(token), address(musd), 60);
        AssetMarketManager manager = new AssetMarketManager(
            address(bare),
            address(token),
            address(musd),
            address(vault),
            address(registry),
            assetId,
            address(this)
        );
        bare.setOracleForTest(-276_324, -276_324);
        vm.expectRevert(AssetMarketManager.PositionNotConfigured.selector);
        manager.slide(-276_540, -275_940);
    }

    // -----------------------------------------------------------------
    // Opportunistic floor level-up on the rebalance path
    // -----------------------------------------------------------------

    function _installRealFloor(uint64 cooldown) private returns (FloorController floor) {
        floor = new FloorController(
            address(vault),
            address(registry),
            assetId,
            market.assetIsToken0(),
            market.tickSpacing(),
            market.assetIsToken0() ? int24(-288_420) : int24(288_420),
            cooldown,
            address(this)
        );
        market.setFloorController(address(floor));
    }

    function _rebalanceAnchorBy(int24 shift) private {
        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.rebalanceToNAV(lower + shift, upper + shift);
    }

    function test_rebalanceAdvancesTheFloorWhenEligible() public {
        FloorController floor = _installRealFloor(0);
        assertTrue(floor.canLevelUp(), "fixture should leave the floor eligible");
        int24 before = floor.floorTick();

        _rebalanceAnchorBy(60);

        assertEq(floor.floorTick(), floor.assetIsToken0() ? before + 60 : before - 60);
    }

    function test_rebalanceSkipsSilentlyWithNoController() public {
        vm.expectEmit(false, false, false, true, address(market));
        emit AssetMarketManager.FloorLevelUpSkipped("NO_CONTROLLER");
        _rebalanceAnchorBy(60);
    }

    function test_rebalanceSkipsWhenTheFloorIsNotEligible() public {
        // A long cooldown that has already been started makes `canLevelUp` false.
        FloorController floor = _installRealFloor(30 days);
        floor.levelUp();
        assertFalse(floor.canLevelUp());

        vm.expectEmit(false, false, false, true, address(market));
        emit AssetMarketManager.FloorLevelUpSkipped("NOT_ELIGIBLE");
        _rebalanceAnchorBy(60);
    }

    /// @dev The property that matters: a failing controller must never take the rebalance with it.
    function test_aRevertingLevelUpDoesNotRevertTheRebalance() public {
        market.setFloorController(address(new HostileFloorController(false)));

        vm.expectEmit(false, false, false, true, address(market));
        emit AssetMarketManager.FloorLevelUpSkipped("LEVEL_UP_REVERTED");
        _rebalanceAnchorBy(60);

        (int24 lower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(lower, (market.assetIsToken0() ? int24(-276_600) : int24(276_000)) + 60);
        assertEq(market.lastRebalanceAt(), block.timestamp, "rebalance must have completed");
    }

    function test_aRevertingCanLevelUpDoesNotRevertTheRebalance() public {
        market.setFloorController(address(new HostileFloorController(true)));

        vm.expectEmit(false, false, false, true, address(market));
        emit AssetMarketManager.FloorLevelUpSkipped("CAN_LEVEL_UP_REVERTED");
        _rebalanceAnchorBy(60);

        assertEq(market.lastRebalanceAt(), block.timestamp, "rebalance must have completed");
    }
}
