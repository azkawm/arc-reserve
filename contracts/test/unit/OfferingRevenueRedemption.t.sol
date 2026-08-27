// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { RevenueDistributor } from "../../src/revenue/RevenueDistributor.sol";
import { CompanyVestingWallet } from "../../src/vesting/CompanyVestingWallet.sol";

contract OfferingRevenueRedemptionTest is ArcReserveTestBase {
    function testOfferingLimitsAndInactiveAsset() public {
        _buy(alice, 1e6);
        vm.startPrank(bob);
        musd.faucet(bob, 1e6);
        musd.approve(address(offering), type(uint256).max);
        vm.expectRevert();
        offering.buy(1, 0);
        vm.stopPrank();

        registry.suspendAsset(assetId);
        vm.startPrank(bob);
        vm.expectRevert();
        offering.buy(1e6, 0);
        vm.stopPrank();
    }

    function testTransferAwareRevenueDoesNotGiveBuyerPastRevenue() public {
        _buy(alice, 10_000e6);
        _depositRevenue(1_000e6);

        vm.prank(alice);
        token.transfer(bob, 5_000e18);
        assertEq(revenue.claimableRevenue(bob), 0);

        _depositRevenue(1_000e6);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 900e6, 2);
        assertApproxEqAbs(revenue.claimableRevenue(bob), 300e6, 2);

        vm.prank(alice);
        revenue.claimRevenue();
        assertEq(revenue.claimableRevenue(alice), 0);
        vm.prank(alice);
        vm.expectRevert(RevenueDistributor.NoRevenueToClaim.selector);
        revenue.claimRevenue();
    }

    function testYieldUsesCirculatingSupplyAndExcludesCompanyVesting() public {
        uint64 vestingStartsAt = uint64(block.timestamp);
        uint64 vestingDuration = uint64(365 days);
        CompanyVestingWallet companyVesting =
            new CompanyVestingWallet(bob, vestingStartsAt, vestingDuration);
        _buy(alice, 10_000e6);

        revenue.setYieldExcluded(address(companyVesting), true);
        token.setComplianceExempt(address(companyVesting), true);
        token.grantRole(token.ISSUANCE_CONTROLLER_ROLE(), address(this));
        token.mint(address(companyVesting), 10_000e18);

        assertEq(token.totalSupply(), 20_000e18);
        assertEq(revenue.excludedSupply(), 10_000e18);
        assertEq(revenue.circulatingSupply(), 10_000e18);
        assertEq(revenue.yieldEligibleBalanceOf(address(companyVesting)), 0);

        _depositRevenue(1_000e6);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 600e6, 2);
        assertEq(revenue.claimableRevenue(address(companyVesting)), 0);

        vm.warp(uint256(vestingStartsAt) + vestingDuration / 2);
        companyVesting.release(address(token));

        assertEq(token.balanceOf(bob), 5_000e18);
        assertEq(revenue.excludedSupply(), 5_000e18);
        assertEq(revenue.circulatingSupply(), 15_000e18);
        assertEq(revenue.claimableRevenue(bob), 0);

        _depositRevenue(1_000e6);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 1_000e6, 3);
        assertApproxEqAbs(revenue.claimableRevenue(bob), 200e6, 3);
        assertEq(revenue.claimableRevenue(address(companyVesting)), 0);
    }

    function testExcludingExistingBalancePreservesPreviouslyEarnedYield() public {
        _buy(alice, 10_000e6);
        _depositRevenue(1_000e6);

        revenue.setYieldExcluded(alice, true);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 600e6, 2);
        assertEq(revenue.circulatingSupply(), 0);

        revenue.setYieldExcluded(alice, false);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 600e6, 2);

        _depositRevenue(1_000e6);
        assertApproxEqAbs(revenue.claimableRevenue(alice), 1_200e6, 4);
    }

    function testRevenueDepositRequiresYieldEligibleCirculatingSupply() public {
        address companyVesting = makeAddr("companyVestingOnly");
        revenue.setYieldExcluded(companyVesting, true);
        token.setComplianceExempt(companyVesting, true);
        token.grantRole(token.ISSUANCE_CONTROLLER_ROLE(), address(this));
        token.mint(companyVesting, 10_000e18);

        musd.faucet(address(this), 1_000e6);
        musd.approve(address(revenue), 1_000e6);
        vm.expectRevert(RevenueDistributor.NoYieldEligibleSupply.selector);
        revenue.depositRevenue(1_000e6);
    }

    function testRevenueGrowsReserveAndKeepsAccountingSolvent() public {
        _buy(alice, 10_000e6);
        uint256 beforeReserve = vault.redemptionReserve();
        _depositRevenue(1_000e6);
        assertEq(vault.redemptionReserve(), beforeReserve + 250e6);
        assertEq(vault.protocolFees(), 50e6);
        assertTrue(vault.isSolvent());
    }

    function testPartialRedemptionBurnsBeforePayingAndCannotRepeat() public {
        _buy(alice, 10_000e6);
        uint256 beforeStable = musd.balanceOf(alice);
        vm.prank(alice);
        uint256 paid =
            redemption.redeem(2_000e18, 2_000e6, RedemptionController.RedemptionMode.Normal);
        assertEq(paid, 2_000e6);
        assertEq(token.balanceOf(alice), 8_000e18);
        assertEq(musd.balanceOf(alice), beforeStable + paid);
        assertTrue(vault.isSolvent());

        vm.prank(alice);
        vm.expectRevert();
        redemption.redeem(9_000e18, 0, RedemptionController.RedemptionMode.Normal);
    }

    function testMaturityAndEmergencyModesAreExplicit() public {
        _buy(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(RedemptionController.InvalidMode.selector);
        redemption.redeem(1e18, 0, RedemptionController.RedemptionMode.Emergency);

        registry.markDefault(assetId);
        redemption.setEmergencySettlementPrice(500_000);
        vm.prank(alice);
        uint256 paid =
            redemption.redeem(100e18, 50e6, RedemptionController.RedemptionMode.Emergency);
        assertEq(paid, 50e6);
    }

    function testPerPeriodLimitPreventsReserveRun() public {
        _buy(alice, 30_000e6);
        vm.prank(alice);
        vm.expectRevert(RedemptionController.PeriodLimitExceeded.selector);
        redemption.redeem(25_001e18, 0, RedemptionController.RedemptionMode.Normal);
    }
}
