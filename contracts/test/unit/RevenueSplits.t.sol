// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { RevenueDistributor } from "../../src/revenue/RevenueDistributor.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-023 dynamic revenue split and D-022 period tagging. The behind-schedule variant moves
///         20 points from holders to the reserve so the sinking fund catches up faster.
contract RevenueSplitsTest is ArcReserveTestBase {
    uint256 internal constant DEPOSIT = 1_000e6;

    uint64 internal scheduleStart;
    uint64 internal scheduleMaturity;

    function setUp() public override {
        super.setUp();
        // 50,000 mUSD raise leaves backing at exactly 0.60.
        _buy(alice, 50_000e6);
        scheduleStart = uint64(block.timestamp);
        scheduleMaturity = registry.maturityOf(assetId);
    }

    /// @dev Schedule starting at current backing, so the target overtakes it immediately. A year
    ///      of drift opens a gap of roughly 6,700 mUSD - wide enough that a single revenue deposit
    ///      cannot accidentally cure it.
    function _goBehindSchedule() internal {
        vault.setReserveSchedule(600_000, 1_000_000, scheduleStart, scheduleMaturity, 30 days);
        vm.warp(block.timestamp + 365 days);
        assertTrue(vault.isBehindSchedule());
    }

    /// @dev Schedule far below current backing: comfortably ahead.
    function _stayOnSchedule() internal {
        vault.setReserveSchedule(100_000, 200_000, scheduleStart, scheduleMaturity, 30 days);
        assertFalse(vault.isBehindSchedule());
    }

    // -----------------------------------------------------------------
    // Defaults
    // -----------------------------------------------------------------

    function test_defaultSplitsMatchTheDecision() public view {
        (uint16 h, uint16 r, uint16 o, uint16 p) = revenue.onScheduleSplit();
        assertEq(h, 6_000);
        assertEq(r, 2_500);
        assertEq(o, 1_000);
        assertEq(p, 500);

        (h, r, o, p) = revenue.behindScheduleSplit();
        assertEq(h, 4_000);
        assertEq(r, 4_500);
        assertEq(o, 1_000);
        assertEq(p, 500);
    }

    function test_noScheduleMeansOnScheduleSplit() public {
        (, bool behind) = revenue.activeSplit();
        assertFalse(behind);

        uint256 reserveBefore = vault.redemptionReserve();
        _depositRevenue(DEPOSIT);
        assertEq(revenue.totalHolderRevenue(), 600e6);
        assertEq(vault.redemptionReserve() - reserveBefore, 250e6);
        assertEq(revenue.operatorAccrued(), 100e6);
        assertEq(vault.protocolFees(), 50e6);
    }

    // -----------------------------------------------------------------
    // The split follows schedule state
    // -----------------------------------------------------------------

    function test_onScheduleUsesSixtyTwentyFive() public {
        _stayOnSchedule();
        uint256 reserveBefore = vault.redemptionReserve();
        _depositRevenue(DEPOSIT);

        assertEq(revenue.totalHolderRevenue(), 600e6);
        assertEq(vault.redemptionReserve() - reserveBefore, 250e6);
    }

    function test_behindScheduleShiftsTwentyPointsToTheReserve() public {
        _goBehindSchedule();
        uint256 reserveBefore = vault.redemptionReserve();
        _depositRevenue(DEPOSIT);

        assertEq(revenue.totalHolderRevenue(), 400e6);
        assertEq(vault.redemptionReserve() - reserveBefore, 450e6);
        // Operator and protocol are untouched by the schedule state.
        assertEq(revenue.operatorAccrued(), 100e6);
        assertEq(vault.protocolFees(), 50e6);
    }

    function test_activeSplitReportsTheLiveState() public {
        _goBehindSchedule();
        (RevenueDistributor.RevenueSplit memory split, bool behind) = revenue.activeSplit();
        assertTrue(behind);
        assertEq(split.holderBps, 4_000);
        assertEq(split.reserveBps, 4_500);
    }

    /// @dev The split is evaluated per deposit, so curing a shortfall restores the holder share
    ///      on the very next deposit without any admin action.
    function test_curingTheShortfallRestoresTheHolderShare() public {
        _goBehindSchedule();
        _depositRevenue(DEPOSIT);
        assertEq(revenue.totalHolderRevenue(), 400e6);

        uint256 needed = vault.targetBackingNow() * 50_000 - vault.redemptionReserve() + 1e6;
        musd.faucet(address(this), needed);
        musd.approve(address(vault), needed);
        vault.depositReserve(needed, 1);
        assertFalse(vault.isBehindSchedule());

        _depositRevenue(DEPOSIT, 2);
        assertEq(revenue.totalHolderRevenue(), 400e6 + 600e6);
    }

    // -----------------------------------------------------------------
    // Split bounds
    // -----------------------------------------------------------------

    function _split(uint16 h, uint16 r, uint16 o, uint16 p)
        internal
        pure
        returns (RevenueDistributor.RevenueSplit memory)
    {
        return RevenueDistributor.RevenueSplit(h, r, o, p);
    }

    function test_splitsMustTotalTenThousand() public {
        vm.expectRevert(RevenueDistributor.InvalidSplits.selector);
        revenue.setRevenueSplits(_split(6_000, 2_500, 1_000, 400), _split(4_000, 4_500, 1_000, 500));
    }

    function test_holdersCannotBeSqueezedBelowTheFloor() public {
        vm.expectRevert(RevenueDistributor.InvalidSplits.selector);
        revenue.setRevenueSplits(_split(2_000, 6_500, 1_000, 500), _split(2_000, 6_500, 1_000, 500));
    }

    function test_operatorShareIsCapped() public {
        vm.expectRevert(RevenueDistributor.InvalidSplits.selector);
        revenue.setRevenueSplits(_split(4_000, 2_400, 3_100, 500), _split(4_000, 2_400, 3_100, 500));
    }

    function test_protocolShareIsCapped() public {
        vm.expectRevert(RevenueDistributor.InvalidSplits.selector);
        revenue.setRevenueSplits(
            _split(4_000, 3_500, 1_000, 1_500), _split(4_000, 3_500, 1_000, 1_500)
        );
    }

    /// @dev The behind-schedule variant exists to refill the reserve. An admin must not be able to
    ///      configure one that routes less to the reserve than the normal split.
    function test_behindVariantCannotFavourTheReserveLess() public {
        vm.expectRevert(RevenueDistributor.InvalidSplits.selector);
        revenue.setRevenueSplits(_split(4_000, 4_500, 1_000, 500), _split(6_000, 2_500, 1_000, 500));
    }

    function test_validSplitsCanBeSet() public {
        revenue.setRevenueSplits(_split(5_000, 3_500, 1_000, 500), _split(3_500, 5_000, 1_000, 500));
        (uint16 h,,,) = revenue.onScheduleSplit();
        assertEq(h, 5_000);

        uint256 reserveBefore = vault.redemptionReserve();
        _depositRevenue(DEPOSIT);
        assertEq(revenue.totalHolderRevenue(), 500e6);
        assertEq(vault.redemptionReserve() - reserveBefore, 350e6);
    }

    function test_onlyAdminCanSetSplits() public {
        bytes32 adminRole = revenue.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        revenue.setRevenueSplits(_split(6_000, 2_500, 1_000, 500), _split(4_000, 4_500, 1_000, 500));
    }

    // -----------------------------------------------------------------
    // Period tagging (D-022)
    // -----------------------------------------------------------------

    function test_depositRecordsPeriodAndEmitsTheReportHash() public {
        bytes32 reportHash = keccak256("march-2026-generation-report");
        musd.faucet(address(this), DEPOSIT);
        musd.approve(address(revenue), DEPOSIT);

        vm.expectEmit(true, true, false, true, address(revenue));
        emit RevenueDistributor.RevenueDeposited(
            address(this), 202_603, reportHash, false, DEPOSIT, 600e6, 250e6, 100e6, 50e6
        );
        revenue.depositRevenue(DEPOSIT, 202_603, reportHash);

        assertEq(revenue.lastPeriodId(), 202_603);
        assertEq(revenue.revenueByPeriod(202_603), DEPOSIT);
        assertEq(revenue.lastRevenueDepositAt(), uint64(block.timestamp));
    }

    function test_multipleDepositsAccumulateWithinAPeriod() public {
        _depositRevenue(DEPOSIT, 202_603);
        _depositRevenue(DEPOSIT, 202_603);
        assertEq(revenue.revenueByPeriod(202_603), 2 * DEPOSIT);
    }

    function test_behindScheduleFlagIsCarriedOnTheEvent() public {
        _goBehindSchedule();
        bytes32 reportHash = keccak256("late-report");
        musd.faucet(address(this), DEPOSIT);
        musd.approve(address(revenue), DEPOSIT);

        vm.expectEmit(true, true, false, true, address(revenue));
        emit RevenueDistributor.RevenueDeposited(
            address(this), 7, reportHash, true, DEPOSIT, 400e6, 450e6, 100e6, 50e6
        );
        revenue.depositRevenue(DEPOSIT, 7, reportHash);
    }

    // -----------------------------------------------------------------
    // Reporting cadence
    // -----------------------------------------------------------------

    function test_overdueIsInertWithoutAPolicy() public view {
        assertEq(revenue.reportingDueAt(), 0);
        assertFalse(revenue.isReportingOverdue());
    }

    function test_freshlyConfiguredAssetIsNotInstantlyLate() public {
        revenue.setReportingPolicy(30 days, 30 days);
        assertFalse(revenue.isReportingOverdue());
        assertEq(revenue.reportingDueAt(), uint64(block.timestamp) + 30 days);
    }

    function test_overdueOnlyAfterPeriodPlusGrace() public {
        revenue.setReportingPolicy(30 days, 30 days);

        vm.warp(block.timestamp + 45 days);
        assertFalse(revenue.isReportingOverdue());

        vm.warp(block.timestamp + 16 days);
        assertTrue(revenue.isReportingOverdue());
    }

    function test_aDepositClearsTheOverdueState() public {
        revenue.setReportingPolicy(30 days, 30 days);
        vm.warp(block.timestamp + 61 days);
        assertTrue(revenue.isReportingOverdue());

        _depositRevenue(DEPOSIT, 2);
        assertFalse(revenue.isReportingOverdue());
    }

    function test_reportingPolicyRejectsGraceWithoutAPeriod() public {
        vm.expectRevert(RevenueDistributor.InvalidReportingPolicy.selector);
        revenue.setReportingPolicy(0, 30 days);
    }

    function test_onlyAdminCanSetReportingPolicy() public {
        bytes32 adminRole = revenue.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        revenue.setReportingPolicy(30 days, 30 days);
    }
}
