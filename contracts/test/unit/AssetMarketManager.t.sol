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

    function testSpotTwapAndNAVRemainSeparateInputs() public view {
        (uint256 spot, uint256 twap,) = market.marketPrices();
        (uint256 nav,) = registry.navOf(assetId);
        assertApproxEqRel(spot, 1e6, 0.001e18);
        assertApproxEqRel(twap, 1e6, 0.001e18);
        assertEq(nav, 1e6);
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

    function testStaleNAVAndSpotTwapDeviationStopRebalancing() public {
        vm.warp(block.timestamp + 2 days + 1);
        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.StaleNAV));
        int24 lower = _anchorLower();
        int24 upper = _anchorUpper();
        vm.expectRevert();
        market.rebalanceToNAV(lower + 60, upper + 60);

        registry.publishNAV(assetId, 1e6);
        _setOneDollarOracle(1_000);
        (failure,,,) = market.safetyState(false);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.SpotTwapDeviation));
    }

    function testSlideIsRateLimitedAndRequiresRemovedLiquidity() public {
        _setOneDollarOracle(10);
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
