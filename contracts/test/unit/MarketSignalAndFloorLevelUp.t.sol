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
    // D-039: NAV gates nothing in the engine (subsumes D-038)
    // -----------------------------------------------------------------

    /// @dev D-038 exempted only `slide`/`sweep` and kept a second view, `repositionSafetyState`,
    ///      to report the difference. D-039 removed the gates outright, so there is one view again
    ///      and `safetyState` must answer `None` while NAV is stale.
    function test_slideWorksWithAStaleNav() public {
        _movePriceOutsideAnchor(true);
        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId), "precondition: NAV must actually be stale");

        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(true);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.None));

        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.slide(lower + 60, upper + 60);
        (int24 newLower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLower, lower + 60, "slide should not be blocked by a stale NAV");
    }

    function test_sweepWorksWithAStaleNav() public {
        _movePriceOutsideAnchor(false);
        vm.warp(block.timestamp + 2 days + 1);

        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.sweep(lower - 60, upper - 60);
        (int24 newLower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLower, lower - 60, "sweep should not be blocked by a stale NAV");
    }

    /// @dev The other retired gate: spot far from NAV. ~35% here, well outside the 20% band that
    ///      used to halt the engine.
    function test_slideWorksWhenSpotIsFarFromNav() public {
        _setOneDollarOracle(3_000);

        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(true);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.None));

        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.slide(lower + 60, upper + 60);
        (int24 newLower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLower, lower + 60);
    }

    /// @dev The inversion of D-038's containment test. Under D-038 a keeper could move an empty
    ///      range while NAV was stale but could NOT fund it; under D-039 capital deployment is not
    ///      NAV-gated either. This test asserts the liquidity actually lands, not merely that the
    ///      call does not revert — "no revert" would also pass if the mint silently did nothing.
    function test_addLiquidityIsNoLongerNavGated() public {
        market.fundFromVault(1_000e6);
        vm.startPrank(alice);
        token.approve(address(market), 100e18);
        market.fundTokenInventory(100e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId), "precondition: NAV must actually be stale");

        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: AssetMarketManager.PositionKind.Anchor,
                liquidity: 1e6,
                maxAmount0: 1e6,
                maxAmount1: 1e6,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
        (,, uint128 liquidity,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(liquidity, 1e6, "capital must deploy with a stale NAV");
    }

    /// @dev The engine's real guards are unchanged. Only the NAV ones went.
    function test_repositioningStillRespectsPauseStatusAndCooldown() public {
        _movePriceOutsideAnchor(true);
        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);

        market.pause();
        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(true);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.Paused));
        market.unpause();

        registry.suspendAsset(assetId);
        (failure,,,) = market.safetyState(true);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.AssetNotActive));
        registry.resumeAsset(assetId);

        market.slide(lower + 60, upper + 60);
        (failure,,,) = market.safetyState(true);
        assertEq(
            uint8(failure), uint8(AssetMarketManager.SafetyFailure.Cooldown), "cooldown still binds"
        );
    }

    /// @dev The whole engine, not just repositioning, under a NAV nobody has refreshed for two
    ///      days: fund, deploy, move the anchor, refresh discovery, collect, withdraw. If any of
    ///      these reacquires a NAV dependency, this is the test that catches it.
    function test_fullEngineCycleWorksWithAStaleNav() public {
        market.fundFromVault(1_000e6);
        vm.startPrank(alice);
        token.approve(address(market), 100e18);
        market.fundTokenInventory(100e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId), "precondition: NAV must actually be stale");

        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: AssetMarketManager.PositionKind.Anchor,
                liquidity: 1e6,
                maxAmount0: 1e6,
                maxAmount1: 1e6,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, 1e6, 0, 0, block.timestamp + 1 hours
        );

        _movePriceOutsideAnchor(true);
        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.slide(lower + 60, upper + 60);

        vm.warp(block.timestamp + 31 minutes);
        (int24 dLower, int24 dUpper,,) = market.positions(AssetMarketManager.PositionKind.Discovery);
        market.refreshDiscovery(dLower + 60, dUpper + 60);

        market.collectFees(AssetMarketManager.PositionKind.Anchor);
        market.returnStablecoinToVault(1e6);
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
