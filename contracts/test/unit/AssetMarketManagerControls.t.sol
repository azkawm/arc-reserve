// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";

contract AssetMarketManagerControlsTest is ArcReserveTestBase {
    uint128 private constant TEST_LIQUIDITY = 10e6;

    uint256 private protectedReserve;

    function setUp() public override {
        super.setUp();
        _buy(alice, 20_000e6);
        _configurePositions();

        protectedReserve = vault.redemptionReserve();
        market.fundFromVault(600e6);

        vm.startPrank(alice);
        token.approve(address(market), 600e18);
        market.fundTokenInventory(600e18);
        vm.stopPrank();
    }

    function testOnlyKeeperAndAdminCanOperateControlPlane() public {
        (int24 reserveLower, int24 reserveUpper,,) =
            market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);

        vm.startPrank(attacker);

        vm.expectRevert();
        market.configureCorePositions(reserveLower, reserveUpper, anchorLower, anchorUpper);

        vm.expectRevert();
        market.fundFromVault(1);

        vm.expectRevert();
        market.returnStablecoinToVault(1);

        vm.expectRevert();
        market.addLiquidity(_liquidityParams(AssetMarketManager.PositionKind.Anchor, 1));

        vm.expectRevert();
        market.removeLiquidity(AssetMarketManager.PositionKind.Anchor, 1, 0, 0, block.timestamp);

        vm.expectRevert();
        market.pause();

        vm.expectRevert();
        market.setSafetyPolicy(30 minutes, 30 minutes, 300, 2_000, 1_200);

        vm.stopPrank();

        assertEq(vault.redemptionReserve(), protectedReserve, "unauthorized reserve change");
        _assertPositionLiquidity(AssetMarketManager.PositionKind.Anchor, 0);
    }

    function testOptionalConfigurationRejectsWrongKindsAndInvalidRanges() public {
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.configureOptionalPosition(AssetMarketManager.PositionKind.Anchor, -600, 600);

        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.configureOptionalPosition(AssetMarketManager.PositionKind.Intermediary, -601, 600);

        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.configureOptionalPosition(AssetMarketManager.PositionKind.Intermediary, 600, 600);

        market.configureOptionalPosition(AssetMarketManager.PositionKind.Intermediary, -600, 600);
        (int24 lower, int24 upper, uint128 liquidity, bool configured) =
            market.positions(AssetMarketManager.PositionKind.Intermediary);
        assertTrue(configured);
        assertEq(lower, -600);
        assertEq(upper, 600);
        assertEq(liquidity, 0);

        _addPosition(AssetMarketManager.PositionKind.Intermediary, TEST_LIQUIDITY);
        vm.expectRevert(AssetMarketManager.PositionHasLiquidity.selector);
        market.configureOptionalPosition(AssetMarketManager.PositionKind.Intermediary, -540, 660);
    }

    function testMarketAllocationRoundTripNeverTouchesProtectedReserve() public {
        uint256 allocationBefore = vault.marketMakingAllocation();
        uint256 managerBalanceBefore = musd.balanceOf(address(market));

        market.fundFromVault(100e6);
        assertEq(vault.marketMakingAllocation(), allocationBefore - 100e6);
        assertEq(musd.balanceOf(address(market)), managerBalanceBefore + 100e6);
        assertEq(vault.redemptionReserve(), protectedReserve);

        market.returnStablecoinToVault(100e6);
        assertEq(vault.marketMakingAllocation(), allocationBefore);
        assertEq(musd.balanceOf(address(market)), managerBalanceBefore);
        assertEq(vault.redemptionReserve(), protectedReserve);
        assertEq(musd.allowance(address(market), address(vault)), 0, "stale vault allowance");
        assertTrue(vault.isSolvent());
    }

    function testPauseStopsNewRiskButAllowsLiquidityExit() public {
        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
        market.pause();

        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.Paused));

        vm.expectRevert();
        market.fundFromVault(1);

        vm.startPrank(alice);
        vm.expectRevert();
        market.fundTokenInventory(1);
        vm.stopPrank();

        vm.expectRevert();
        market.addLiquidity(_liquidityParams(AssetMarketManager.PositionKind.Anchor, 1));

        vm.expectRevert();
        market.executeSwap(_swapParams(true, 1_000, 1_000, 990));

        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor,
            TEST_LIQUIDITY,
            TEST_LIQUIDITY,
            TEST_LIQUIDITY,
            block.timestamp
        );
        _assertPositionLiquidity(AssetMarketManager.PositionKind.Anchor, 0);
        assertEq(vault.redemptionReserve(), protectedReserve);

        market.unpause();
        _assertSafetyFailure(AssetMarketManager.SafetyFailure.None);
        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
        _assertPositionLiquidity(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
    }

    function testFeeCollectionRequiresConfiguredPositionAndHandlesNoAccrual() public {
        vm.expectRevert(AssetMarketManager.PositionNotConfigured.selector);
        market.collectFees(AssetMarketManager.PositionKind.Intermediary);

        (uint256 amount0, uint256 amount1) =
            market.collectFees(AssetMarketManager.PositionKind.Anchor);
        assertEq(amount0, 0);
        assertEq(amount1, 0);
    }

    function testLiquidityLifecycleRejectsUnconfiguredInvalidAndSlippingRemoval() public {
        vm.expectRevert(AssetMarketManager.PositionNotConfigured.selector);
        market.addLiquidity(
            _liquidityParams(AssetMarketManager.PositionKind.Intermediary, TEST_LIQUIDITY)
        );

        vm.expectRevert(AssetMarketManager.PositionNotConfigured.selector);
        market.removeLiquidity(AssetMarketManager.PositionKind.Anchor, 0, 0, 0, block.timestamp);

        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);

        vm.expectRevert(AssetMarketManager.PositionNotConfigured.selector);
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY + 1, 0, 0, block.timestamp
        );

        vm.expectRevert(AssetMarketManager.DeadlineExpired.selector);
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY, 0, 0, block.timestamp - 1
        );

        vm.expectRevert(AssetMarketManager.SlippageExceeded.selector);
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor,
            TEST_LIQUIDITY,
            TEST_LIQUIDITY + 1,
            TEST_LIQUIDITY,
            block.timestamp
        );

        _assertPositionLiquidity(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(_poolLiquidity(lower, upper), TEST_LIQUIDITY, "removal must roll back");
    }

    function testActiveLiquidityBlocksAllManagedRangeChanges() public {
        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
        _addPosition(AssetMarketManager.PositionKind.Discovery, TEST_LIQUIDITY);

        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        (int24 discoveryLower, int24 discoveryUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Discovery);

        // D-036: the direction signal must be satisfied first, otherwise these revert on the signal
        // rather than on the liquidity check this test is about.
        _movePriceOutsideAnchor(true);
        vm.expectRevert(AssetMarketManager.PositionHasLiquidity.selector);
        market.slide(anchorLower + 60, anchorUpper + 60);

        vm.expectRevert(AssetMarketManager.PositionHasLiquidity.selector);
        market.rebalanceToNAV(anchorLower + 60, anchorUpper + 60);

        vm.expectRevert(AssetMarketManager.PositionHasLiquidity.selector);
        market.refreshDiscovery(discoveryLower + 60, discoveryUpper + 60);

        _movePriceOutsideAnchor(false);
        vm.expectRevert(AssetMarketManager.PositionHasLiquidity.selector);
        market.sweep(anchorLower - 60, anchorUpper - 60);

        _assertPositionLiquidity(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);
        _assertPositionLiquidity(AssetMarketManager.PositionKind.Discovery, TEST_LIQUIDITY);
    }

    function testRebalancesEnforceDirectionTickAlignmentAndMaximumShift() public {
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);

        // D-036 direction: while spot sits INSIDE the anchor range the position is working, so
        // neither move is permitted.
        _setOneDollarOracle(0);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 60, anchorUpper + 60);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.sweep(anchorLower - 60, anchorUpper - 60);

        // Price left on the downside: an upward slide is still refused.
        _movePriceOutsideAnchor(false);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 60, anchorUpper + 60);

        // Price left on the upside: a downward sweep is refused.
        _movePriceOutsideAnchor(true);
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.sweep(anchorLower - 60, anchorUpper - 60);

        // Signal satisfied, so the shift ceiling and tick alignment are what bite now.
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 1_260, anchorUpper + 1_260);

        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 1, anchorUpper + 1);

        assertEq(market.lastRebalanceAt(), 0, "failed moves must not start cooldown");
    }

    function testRebalanceToNAVUpdatesAnEmptyAnchorWithinPolicy() public {
        (int24 oldLower, int24 oldUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);

        int24 newLower = oldLower + 60;
        int24 newUpper = oldUpper + 60;
        market.rebalanceToNAV(newLower, newUpper);

        (int24 actualLower, int24 actualUpper, uint128 liquidity, bool configured) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        assertTrue(configured);
        assertEq(actualLower, newLower);
        assertEq(actualUpper, newUpper);
        assertEq(liquidity, 0);
        assertEq(market.lastRebalanceAt(), block.timestamp);
        assertEq(vault.redemptionReserve(), protectedReserve);
    }

    function testSwapsExecuteInBothDirectionsWithBoundedAccounting() public {
        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);

        uint256 managerToken0Before = market.token0().balanceOf(address(market));
        uint256 managerToken1Before = market.token1().balanceOf(address(market));

        (uint256 amountIn0, uint256 amountOut1) =
            market.executeSwap(_swapParams(true, 1_000, 1_000, 990));
        assertEq(amountIn0, 1_000);
        assertEq(amountOut1, 990);

        (uint256 amountIn1, uint256 amountOut0) =
            market.executeSwap(_swapParams(false, 1_000, 1_000, 990));
        assertEq(amountIn1, 1_000);
        assertEq(amountOut0, 990);

        assertEq(
            market.token0().balanceOf(address(market)),
            managerToken0Before - 10,
            "unexpected token0 swap accounting"
        );
        assertEq(
            market.token1().balanceOf(address(market)),
            managerToken1Before - 10,
            "unexpected token1 swap accounting"
        );
        assertEq(vault.redemptionReserve(), protectedReserve);
    }

    function testSwapRejectsZeroExpiredExcessInputAndInsufficientOutput() public {
        _addPosition(AssetMarketManager.PositionKind.Anchor, TEST_LIQUIDITY);

        vm.expectRevert(AssetMarketManager.InvalidSwapDirection.selector);
        market.executeSwap(_swapParams(true, 0, 0, 0));

        AssetMarketManager.SwapParams memory expired = _swapParams(true, 1_000, 1_000, 990);
        expired.deadline = block.timestamp - 1;
        vm.expectRevert(AssetMarketManager.DeadlineExpired.selector);
        market.executeSwap(expired);

        vm.expectRevert(AssetMarketManager.SlippageExceeded.selector);
        market.executeSwap(_swapParams(true, 1_000, 999, 990));

        vm.expectRevert(AssetMarketManager.SlippageExceeded.selector);
        market.executeSwap(_swapParams(true, 1_000, 1_000, 991));

        assertEq(vault.redemptionReserve(), protectedReserve);
    }

    function testSafetyPolicyIsAdminOnlyValidatedAndApplied() public {
        vm.prank(attacker);
        vm.expectRevert();
        market.setSafetyPolicy(15 minutes, 10 minutes, 200, 1_500, 600);

        vm.expectRevert(AssetMarketManager.InvalidPolicy.selector);
        market.setSafetyPolicy(15 minutes, 0, 200, 1_500, 600);

        vm.expectRevert(AssetMarketManager.InvalidPolicy.selector);
        market.setSafetyPolicy(15 minutes, 10 minutes, 200, 10_001, 600);

        vm.expectRevert(AssetMarketManager.InvalidPolicy.selector);
        market.setSafetyPolicy(15 minutes, 10 minutes, 200, 1_500, 0);

        // D-036: the first and third arguments are dead. Their validation is deliberately gone, so
        // a caller may pass 0 and mean "not applicable" rather than inventing a plausible number
        // for a knob that configures nothing - and an out-of-range basis-point value is accepted
        // too, because nothing reads it.
        market.setSafetyPolicy(0, 10 minutes, 10_001, 1_500, 600);

        // They are also emitted as 0, so no indexer records a policy that was never set.
        vm.expectEmit(false, false, false, true, address(market));
        emit AssetMarketManager.SafetyPolicyUpdated(0, 10 minutes, 0, 1_500, 600);
        market.setSafetyPolicy(15 minutes, 10 minutes, 200, 1_500, 600);

        assertEq(market.rebalanceCooldown(), 10 minutes);
        assertEq(market.maxMarketNAVDeviationBps(), 1_500);
        assertEq(market.maxTickShift(), 600);
    }

    /// @notice D-036 demo pacing: a 1-second cooldown still refuses two rebalances in the same
    ///         block, so the refusal stays demonstrable while a demo a second apart runs freely.
    function testOneSecondCooldownStillRefusesTwoRebalancesInOneBlock() public {
        market.setSafetyPolicy(0, 1, 0, 2_000, 1_200);
        (int24 lower, int24 upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);

        market.rebalanceToNAV(lower + 60, upper + 60);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetMarketManager.SafetyCheckFailed.selector,
                AssetMarketManager.SafetyFailure.Cooldown
            )
        );
        market.rebalanceToNAV(lower + 120, upper + 120);

        vm.warp(block.timestamp + 2);
        market.rebalanceToNAV(lower + 120, upper + 120);
    }

    function testSafetyRejectsInactiveAssetBeforeMarketAction() public {
        registry.suspendAsset(assetId);
        _assertSafetyFailure(AssetMarketManager.SafetyFailure.AssetNotActive);

        vm.expectRevert(
            abi.encodeWithSelector(
                AssetMarketManager.SafetyCheckFailed.selector,
                AssetMarketManager.SafetyFailure.AssetNotActive
            )
        );
        market.fundFromVault(1);
    }

    function testSafetyRejectsMaturedAsset() public {
        vm.warp(registry.maturityOf(assetId));
        _assertSafetyFailure(AssetMarketManager.SafetyFailure.Matured);
    }

    /// @dev D-036: the guard now reads SPOT against NAV, and `safetyState`'s third return value is
    ///      permanently 0 rather than a time-weighted price.
    function testSafetyRejectsMarketNAVDeviationOnSpot() public {
        _setFlatMarketOffset(3_000);
        (AssetMarketManager.SafetyFailure failure, uint256 spot, uint256 twap, uint256 nav) =
            market.safetyState(false);

        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.MarketNAVDeviation));
        assertEq(twap, 0, "the retired TWAP slot must report 0");
        assertGt(spot, nav, "market should be above NAV");
    }

    function testSafetyRejectsAccountingInsolventVault() public {
        deal(address(musd), address(vault), vault.totalAccounted() - 1);
        assertFalse(vault.isSolvent());
        _assertSafetyFailure(AssetMarketManager.SafetyFailure.ReserveBelowMinimum);
    }

    function _assertSafetyFailure(AssetMarketManager.SafetyFailure expected) private view {
        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertEq(uint8(failure), uint8(expected));
    }

    function _assertPositionLiquidity(
        AssetMarketManager.PositionKind kind,
        uint128 expectedLiquidity
    ) private view {
        (,, uint128 liquidity,) = market.positions(kind);
        assertEq(liquidity, expectedLiquidity);
    }

    function _addPosition(AssetMarketManager.PositionKind kind, uint128 liquidity) private {
        market.addLiquidity(_liquidityParams(kind, liquidity));
    }

    function _liquidityParams(AssetMarketManager.PositionKind kind, uint128 liquidity)
        private
        view
        returns (AssetMarketManager.AddLiquidityParams memory)
    {
        return AssetMarketManager.AddLiquidityParams({
            kind: kind,
            liquidity: liquidity,
            maxAmount0: liquidity,
            maxAmount1: liquidity,
            minimumAmount0: liquidity,
            minimumAmount1: liquidity,
            deadline: block.timestamp
        });
    }

    function _swapParams(
        bool zeroForOne,
        int256 amountSpecified,
        uint256 maximumInput,
        uint256 minimumOutput
    ) private view returns (AssetMarketManager.SwapParams memory) {
        return AssetMarketManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: 1,
            maximumInput: maximumInput,
            minimumOutput: minimumOutput,
            deadline: block.timestamp
        });
    }

    function _poolLiquidity(int24 lower, int24 upper) private view returns (uint128) {
        return pool.liquidityOf(keccak256(abi.encode(address(market), lower, upper)));
    }

    function _setFlatMarketOffset(int24 priceOffset) private {
        int24 oneDollarTick = market.assetIsToken0() ? int24(-276_324) : int24(276_324);
        int24 directedOffset = market.assetIsToken0() ? priceOffset : -priceOffset;
        int24 marketTick = oneDollarTick + directedOffset;
        pool.setOracleForTest(marketTick, marketTick);
    }
}
