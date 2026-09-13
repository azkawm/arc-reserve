// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";

contract AssetMarketManagerTest is ArcReserveTestBase {
    function setUp() public override {
        super.setUp();
        _buy(alice, 20_000e6);
        _configurePositions();
        market.fundFromVault(1_000e6);
        vm.startPrank(alice);
        token.approve(address(market), 100e18);
        market.fundTokenInventory(100e18);
        vm.stopPrank();
    }

    /// @notice D-036: the engine publishes no time-weighted price. The three-value shape is kept
    ///         for ABI stability, but the second and third slots are always 0 - never spot, because
    ///         a plausible number under a wrong label is the one failure a consumer cannot detect.
    function testMarketPricesPublishesSpotAndZeroForTheRetiredTwapSlots() public view {
        (uint256 spot, uint256 twap, int24 meanTick) = market.marketPrices();
        (uint256 nav,) = registry.navOf(assetId);
        assertApproxEqRel(spot, 1e6, 0.001e18);
        assertEq(twap, 0, "twapPrice slot must be 0, not spot");
        assertEq(meanTick, 0, "meanTick slot must be 0");
        assertEq(nav, 1e6);
    }

    /// @notice Spot and NAV remain separate inputs; only the TWAP was retired.
    function testSpotAndNAVRemainSeparateInputs() public {
        _setOneDollarOracle(600);
        (uint256 spot,,) = market.marketPrices();
        (uint256 nav,) = registry.navOf(assetId);
        assertGt(spot, nav, "spot must move independently of NAV");
        assertEq(nav, 1e6, "NAV is verifier-set and unmoved by trading");
    }

    function testAnchorAndReservePositionsMintAndRemoveLiquidity() public {
        market.addLiquidity(_liquidityParams(1e6, 1e6, 1e6, 1e6, 1e6, block.timestamp));
        (,, uint128 liquidity,) = _position(AssetMarketManager.PositionKind.Anchor);
        assertEq(liquidity, 1e6);

        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, 1e6, 1e6, 1e6, block.timestamp
        );
        (,, liquidity,) = _position(AssetMarketManager.PositionKind.Anchor);
        assertEq(liquidity, 0);

        market.addLiquidity(
            _liquidityParamsFor(
                AssetMarketManager.PositionKind.ReserveFloor,
                2e6,
                2e6,
                2e6,
                2e6,
                2e6,
                block.timestamp
            )
        );
        (,, liquidity,) = _position(AssetMarketManager.PositionKind.ReserveFloor);
        assertEq(liquidity, 2e6);
        market.removeLiquidity(
            AssetMarketManager.PositionKind.ReserveFloor, 2e6, 2e6, 2e6, block.timestamp
        );
    }

    function testRejectsIncorrectCallbackCaller() public {
        vm.prank(attacker);
        vm.expectRevert(AssetMarketManager.InvalidCallback.selector);
        market.uniswapV3MintCallback(1, 1, hex"");

        vm.prank(attacker);
        vm.expectRevert(AssetMarketManager.InvalidCallback.selector);
        market.uniswapV3SwapCallback(1, -1, hex"");
    }

    function testRejectsExpiredDeadlineAndSlippage() public {
        vm.expectRevert(AssetMarketManager.DeadlineExpired.selector);
        market.addLiquidity(_liquidityParams(1, 1, 1, 0, 0, block.timestamp - 1));

        vm.expectRevert(AssetMarketManager.SlippageExceeded.selector);
        market.addLiquidity(_liquidityParams(10, 9, 10, 0, 0, block.timestamp));
    }

    /// @dev D-039 inverts what this test used to assert. NAV is a tracing variable: neither a
    ///      two-day-stale NAV nor a spot price far away from it stops the engine. The old names are
    ///      kept in the test name so the git history reads as an inversion, not a deletion.
    function testStaleNAVAndMarketNAVDeviationNoLongerStopRebalancing() public {
        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId), "precondition: NAV must actually be stale");

        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertEq(
            uint8(failure),
            uint8(AssetMarketManager.SafetyFailure.None),
            "a stale NAV must not appear as a safety failure"
        );
        int24 lower = _anchorLower();
        int24 upper = _anchorUpper();
        market.rebalanceToNAV(lower + 60, upper + 60);
        assertEq(_anchorLower(), lower + 60, "rebalance must proceed against a stale NAV");

        // ~22% away from NAV in price terms: past the band that used to halt the engine.
        vm.warp(block.timestamp + 31 minutes);
        _setOneDollarOracle(2_000);
        (failure,,,) = market.safetyState(false);
        assertEq(
            uint8(failure),
            uint8(AssetMarketManager.SafetyFailure.None),
            "spot far from NAV must not appear as a safety failure"
        );
        market.rebalanceToNAV(lower + 120, upper + 120);
        assertEq(_anchorLower(), lower + 120, "rebalance must proceed with spot far from NAV");
    }

    /// @notice Three failure codes are reserved and must never be returned, so no consumer's
    ///         failure-code mapping shifts underneath it: 5 since D-036 retired the spot/TWAP gate,
    ///         4 and 6 since D-039 took NAV out of the engine entirely.
    function testRetiredNavAndTwapFailureCodesAreReservedAndNeverReturned() public {
        assertEq(uint8(AssetMarketManager.SafetyFailure.StaleNAV), 4);
        assertEq(uint8(AssetMarketManager.SafetyFailure.SpotTwapDeviation), 5);
        assertEq(uint8(AssetMarketManager.SafetyFailure.MarketNAVDeviation), 6);
        assertEq(uint8(AssetMarketManager.SafetyFailure.ReserveBelowMinimum), 7);
        assertEq(uint8(AssetMarketManager.SafetyFailure.Cooldown), 8);

        // Both halves of the retired conditions: spot far from NAV, and NAV never republished.
        int24[5] memory offsets = [int24(0), int24(600), int24(-600), int24(3_000), int24(-3_000)];
        for (uint256 pass = 0; pass < 2; pass++) {
            if (pass == 1) vm.warp(block.timestamp + 2 days + 1);
            for (uint256 i = 0; i < offsets.length; i++) {
                _setOneDollarOracle(offsets[i]);
                (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(true);
                assertTrue(
                    failure != AssetMarketManager.SafetyFailure.StaleNAV
                        && failure != AssetMarketManager.SafetyFailure.SpotTwapDeviation
                        && failure != AssetMarketManager.SafetyFailure.MarketNAVDeviation,
                    "reserved failure code was returned"
                );
            }
        }
    }

    function testSlideIsRateLimitedAndRequiresRemovedLiquidity() public {
        _movePriceOutsideAnchor(true);
        int24 firstLower = _anchorLower() + 60;
        int24 firstUpper = _anchorUpper() + 60;
        market.slide(firstLower, firstUpper);
        int24 secondLower = firstLower + 60;
        int24 secondUpper = firstUpper + 60;
        vm.expectRevert();
        market.slide(secondLower, secondUpper);
    }

    function _position(AssetMarketManager.PositionKind kind)
        private
        view
        returns (int24 lower, int24 upper, uint128 liquidity, bool configured)
    {
        return market.positions(kind);
    }

    function _liquidityParams(
        uint128 liquidity,
        uint256 max0,
        uint256 max1,
        uint256 min0,
        uint256 min1,
        uint256 deadline
    ) private pure returns (AssetMarketManager.AddLiquidityParams memory) {
        return _liquidityParamsFor(
            AssetMarketManager.PositionKind.Anchor, liquidity, max0, max1, min0, min1, deadline
        );
    }

    function _liquidityParamsFor(
        AssetMarketManager.PositionKind kind,
        uint128 liquidity,
        uint256 max0,
        uint256 max1,
        uint256 min0,
        uint256 min1,
        uint256 deadline
    ) private pure returns (AssetMarketManager.AddLiquidityParams memory) {
        return AssetMarketManager.AddLiquidityParams({
                kind: kind,
                liquidity: liquidity,
                maxAmount0: max0,
                maxAmount1: max1,
                minimumAmount0: min0,
                minimumAmount1: min1,
                deadline: deadline
            });
    }

    function _anchorLower() private view returns (int24 lower) {
        (lower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
    }

    function _anchorUpper() private view returns (int24 upper) {
        (, upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
    }
}
