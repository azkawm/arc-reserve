// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";

contract ArcReserveLifecycleIntegrationTest is ArcReserveTestBase {
    function testCompleteSolarAssetLifecycle() public {
        assertEq(uint8(registry.statusOf(assetId)), uint8(IAssetRegistry.AssetStatus.Active));
        assertEq(vault.redemptionReserve(), 20_000e6);

        _buy(alice, 25_000e6);
        assertEq(token.balanceOf(alice), 25_000e18);
        // 20,000 seed + 30% of the 25,000 raise (D-023).
        assertEq(vault.redemptionReserve(), 27_500e6);

        _configurePositions();
        market.fundFromVault(1_000e6);
        vm.startPrank(alice);
        token.approve(address(market), 10e18);
        market.fundTokenInventory(10e18);
        vm.stopPrank();

        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: AssetMarketManager.PositionKind.Anchor,
                liquidity: 1e6,
                maxAmount0: 1e6,
                maxAmount1: 1e6,
                minimumAmount0: 1e6,
                minimumAmount1: 1e6,
                deadline: block.timestamp
            })
        );

        // The mock pool exercises the canonical swap callback path as a local secondary trade.
        market.executeSwap(
            AssetMarketManager.SwapParams({
                zeroForOne: true,
                amountSpecified: 1_000,
                sqrtPriceLimitX96: 1,
                maximumInput: 1_000,
                minimumOutput: 990,
                deadline: block.timestamp
            })
        );

        uint256 reserveBeforeRevenue = vault.redemptionReserve();
        _depositRevenue(1_000e6);
        assertEq(vault.redemptionReserve(), reserveBeforeRevenue + 250e6);
        uint256 claimable = revenue.claimableRevenue(alice);
        assertGt(claimable, 599e6);
        vm.prank(alice);
        revenue.claimRevenue();

        vm.prank(alice);
        redemption.redeem(2_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertEq(token.balanceOf(alice), 22_990e18);
        assertTrue(vault.isSolvent());

        market.removeLiquidity(AssetMarketManager.PositionKind.Anchor, 1e6, 0, 0, block.timestamp);
        _setOneDollarOracle(10);
        int24 lower;
        int24 upper;
        (lower, upper,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        market.slide(lower + 60, upper + 60);

        uint64 maturity = registry.maturityOf(assetId);
        vm.warp(maturity);
        registry.markMatured(assetId);
        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertTrue(
            failure == AssetMarketManager.SafetyFailure.AssetNotActive
                || failure == AssetMarketManager.SafetyFailure.Matured
        );

        vm.prank(alice);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Maturity);
        assertTrue(vault.isSolvent());
    }

    function testDefaultPausesIssuanceMarketAndEnablesEmergencySettlement() public {
        _buy(alice, 5_000e6);
        registry.markDefault(assetId);
        token.pause();
        assertFalse(registry.canIssue(assetId));
        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(false);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.AssetNotActive));

        redemption.setEmergencySettlementPrice(400_000);
        vm.prank(alice);
        redemption.redeem(100e18, 40e6, RedemptionController.RedemptionMode.Emergency);
        assertTrue(vault.isSolvent());
    }

    function testFullRedemptionBurnsAllOutstandingHolderTokens() public {
        _buy(alice, 1_000e6);
        vm.prank(alice);
        redemption.redeem(1_000e18, 1_000e6, RedemptionController.RedemptionMode.Normal);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), 0);
        assertEq(redemption.outstandingTokenObligations(), 0);
        assertTrue(vault.isSolvent());
    }
}
