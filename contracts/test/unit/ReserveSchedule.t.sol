// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-023: the sinking-fund reserve schedule, shortfall detection, and the issuer-proceeds
///         gate. The demo shape used here is a 50,000 mUSD raise, which leaves backing at 0.60,
///         climbing on a three-year line to 1.00.
contract ReserveScheduleTest is ArcReserveTestBase {
    uint64 internal constant GRACE = 30 days;
    uint256 internal constant START_BACKING = 600_000; // 0.60 mUSD per token
    uint256 internal constant TARGET_BACKING = 1_000_000; // 1.00 mUSD per token

    uint64 internal scheduleStart;
    uint64 internal scheduleMaturity;

    function setUp() public override {
        super.setUp();
        // 50,000 mUSD raise: reserve becomes 20,000 seed + 20% of 50,000 = 30,000 against
        // 50,000 investor tokens, i.e. backing of exactly 0.60.
        _buy(alice, 50_000e6);
        scheduleStart = uint64(block.timestamp);
        scheduleMaturity = registry.maturityOf(assetId);
    }

    function _setSchedule() internal {
        vault.setReserveSchedule(
            START_BACKING, TARGET_BACKING, scheduleStart, scheduleMaturity, GRACE
        );
    }

    // -----------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------

    function test_backingIsSixDecimalsPerInvestorToken() public view {
        assertEq(vault.currentBacking(), 600_000);
        assertEq(token.investorSupply(), 50_000e18);
    }

    function test_unconfiguredScheduleIsInert() public view {
        assertEq(vault.targetBackingNow(), 0);
        assertFalse(vault.isBehindSchedule());
        assertFalse(vault.isInEnforcedShortfall());
    }

    function test_issuerCanWithdrawWithoutASchedule() public {
        vault.withdrawIssuerProceeds(1_000e6);
        assertEq(musd.balanceOf(address(this)) > 0, true);
    }

    // -----------------------------------------------------------------
    // Schedule configuration
    // -----------------------------------------------------------------

    function test_setScheduleStoresAndEmits() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit AssetVault.ReserveScheduleSet(
            START_BACKING, TARGET_BACKING, scheduleStart, scheduleMaturity, GRACE
        );
        _setSchedule();

        (
            uint256 startBacking,
            uint256 targetBacking,
            uint64 startTime,
            uint64 maturity,
            uint64 graceSeconds,
            bool configured
        ) = vault.reserveSchedule();
        assertEq(startBacking, START_BACKING);
        assertEq(targetBacking, TARGET_BACKING);
        assertEq(startTime, scheduleStart);
        assertEq(maturity, scheduleMaturity);
        assertEq(graceSeconds, GRACE);
        assertTrue(configured);
    }

    function test_scheduleRejectsMaturityAtOrBeforeStart() public {
        vm.expectRevert(AssetVault.InvalidSchedule.selector);
        vault.setReserveSchedule(START_BACKING, TARGET_BACKING, scheduleStart, scheduleStart, GRACE);
    }

    function test_scheduleRejectsZeroTarget() public {
        vm.expectRevert(AssetVault.InvalidSchedule.selector);
        vault.setReserveSchedule(0, 0, scheduleStart, scheduleMaturity, GRACE);
    }

    function test_scheduleRejectsDecliningCurve() public {
        vm.expectRevert(AssetVault.InvalidSchedule.selector);
        vault.setReserveSchedule(
            TARGET_BACKING, START_BACKING, scheduleStart, scheduleMaturity, GRACE
        );
    }

    function test_onlyAdminCanSetSchedule() public {
        bytes32 adminRole = vault.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        vault.setReserveSchedule(
            START_BACKING, TARGET_BACKING, scheduleStart, scheduleMaturity, GRACE
        );
    }

    // -----------------------------------------------------------------
    // The curve
    // -----------------------------------------------------------------

    function test_targetIsFlatBeforeStartAndAtMaturity() public {
        _setSchedule();
        assertEq(vault.targetBackingAt(scheduleStart - 1 days), START_BACKING);
        assertEq(vault.targetBackingAt(scheduleStart), START_BACKING);
        assertEq(vault.targetBackingAt(scheduleMaturity), TARGET_BACKING);
        assertEq(vault.targetBackingAt(scheduleMaturity + 365 days), TARGET_BACKING);
    }

    function test_targetIsLinearAcrossTheTerm() public {
        _setSchedule();
        uint64 span = scheduleMaturity - scheduleStart;
        // Halfway through the term the target sits halfway between 0.60 and 1.00.
        assertEq(vault.targetBackingAt(scheduleStart + span / 2), 800_000);
        // A third of the way: 0.60 + 0.40/3.
        assertEq(
            vault.targetBackingAt(scheduleStart + span / 3),
            START_BACKING + (TARGET_BACKING - START_BACKING) / 3
        );
    }

    // -----------------------------------------------------------------
    // Shortfall detection
    // -----------------------------------------------------------------

    function test_onScheduleAtSettlement() public {
        _setSchedule();
        assertFalse(vault.isBehindSchedule());
        assertEq(vault.shortfallSince(), 0);
    }

    function test_driftsBehindAsTheTargetRises() public {
        _setSchedule();
        vm.warp(block.timestamp + 365 days);
        // Backing is still 0.60; the target has climbed past it.
        assertEq(vault.currentBacking(), 600_000);
        assertGt(vault.targetBackingNow(), 600_000);
        assertTrue(vault.isBehindSchedule());
    }

    function test_syncRecordsEntryAndIsPermissionless() public {
        _setSchedule();
        vm.warp(block.timestamp + 365 days);

        vm.prank(attacker);
        vault.syncShortfall();
        // The published start is the derived crossing time, not the moment someone looked. Backing
        // sits exactly at `startBacking`, so the target overtook it as soon as the curve began.
        assertEq(vault.shortfallSince(), scheduleStart);
    }

    function test_syncWorksWhilePaused() public {
        _setSchedule();
        vm.warp(block.timestamp + 365 days);
        vault.pause();
        vault.syncShortfall();
        assertEq(vault.shortfallSince(), scheduleStart);
    }

    function test_noInvestorSupplyIsNeverBehind() public {
        // Redeem the entire investor position, then check an aggressive schedule stays inert.
        vm.prank(alice);
        redemption.redeem(25_000e18, 0, RedemptionController.RedemptionMode.Normal);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        redemption.redeem(25_000e18, 0, RedemptionController.RedemptionMode.Normal);

        assertEq(token.investorSupply(), 0);
        _setSchedule();
        vm.warp(block.timestamp + 365 days);
        assertFalse(vault.isBehindSchedule());
    }

    // -----------------------------------------------------------------
    // Enforcement
    // -----------------------------------------------------------------

    function test_withinGraceTheIssuerCanStillWithdraw() public {
        _setSchedule();
        vm.warp(block.timestamp + 10 days);

        assertTrue(vault.isBehindSchedule());
        assertEq(vault.shortfallStartedAt(), scheduleStart);
        assertFalse(vault.isInEnforcedShortfall());
        vault.withdrawIssuerProceeds(1_000e6);
    }

    /// @dev The point of deriving the crossing time rather than observing it: an issuer cannot let
    ///      the asset sit untouched and then claim a fresh grace window by being the first to sync.
    function test_enforcementDoesNotRequireAnyPriorSync() public {
        _setSchedule();
        vm.warp(block.timestamp + GRACE + 1);

        // Nobody has called syncShortfall, so the published field is still empty...
        assertEq(vault.shortfallSince(), 0);
        // ...but the gate is already closed.
        assertTrue(vault.isInEnforcedShortfall());
        vm.expectRevert(AssetVault.ReserveShortfallActive.selector);
        vault.withdrawIssuerProceeds(1_000e6);
    }

    function test_pastGraceIssuerWithdrawalIsBlocked() public {
        _setSchedule();
        vault.syncShortfall();

        vm.warp(block.timestamp + GRACE + 1);
        assertTrue(vault.isInEnforcedShortfall());
        vm.expectRevert(AssetVault.ReserveShortfallActive.selector);
        vault.withdrawIssuerProceeds(1_000e6);
    }

    function test_cureRestoresWithdrawal() public {
        _setSchedule();
        vm.warp(block.timestamp + 365 days);
        vault.syncShortfall();
        vm.warp(block.timestamp + GRACE + 1);

        vm.expectRevert(AssetVault.ReserveShortfallActive.selector);
        vault.withdrawIssuerProceeds(1_000e6);

        // Top the sinking fund up past the current target and the state clears itself.
        uint256 needed = vault.targetBackingNow() * 50_000 - vault.redemptionReserve() + 1e6;
        musd.faucet(address(this), needed);
        musd.approve(address(vault), needed);
        vault.depositReserve(needed, 1);

        assertFalse(vault.isBehindSchedule());
        assertEq(vault.shortfallSince(), 0);
        vault.withdrawIssuerProceeds(1_000e6);
    }

    function test_shortfallDoesNotBlockRedemption() public {
        _setSchedule();
        vm.warp(block.timestamp + 365 days);
        vault.syncShortfall();
        vm.warp(block.timestamp + GRACE + 1);
        assertTrue(vault.isInEnforcedShortfall());

        // Investors must always be able to exit; only the issuer's capital is frozen.
        vm.prank(alice);
        uint256 paid = redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertGt(paid, 0);
    }

    // -----------------------------------------------------------------
    // Contributions
    // -----------------------------------------------------------------

    function test_depositReserveCreditsAndTagsThePeriod() public {
        _setSchedule();
        uint256 before = vault.redemptionReserve();
        musd.faucet(address(this), 5_000e6);
        musd.approve(address(vault), 5_000e6);

        vm.expectEmit(true, true, false, true, address(vault));
        emit AssetVault.ReserveContribution(address(this), 7, 5_000e6, before + 5_000e6);
        vault.depositReserve(5_000e6, 7);

        assertEq(vault.redemptionReserve(), before + 5_000e6);
    }

    function test_onlyIssuerCanDepositReserve() public {
        musd.faucet(attacker, 1_000e6);
        vm.startPrank(attacker);
        musd.approve(address(vault), 1_000e6);
        vm.expectRevert(AssetVault.UnauthorizedIssuer.selector);
        vault.depositReserve(1_000e6, 1);
        vm.stopPrank();
    }

    function test_contributionRaisesBackingTowardTheTarget() public {
        _setSchedule();
        uint256 backingBefore = vault.currentBacking();
        musd.faucet(address(this), 5_000e6);
        musd.approve(address(vault), 5_000e6);
        vault.depositReserve(5_000e6, 1);
        // 5,000 mUSD over 50,000 investor tokens is exactly +0.10 of backing.
        assertEq(vault.currentBacking(), backingBefore + 100_000);
    }

    // -----------------------------------------------------------------
    // Backing never falls through a redemption (D-025 relies on this)
    // -----------------------------------------------------------------

    function test_redemptionNeverLowersBacking() public {
        _setSchedule();
        uint256 backingBefore = vault.currentBacking();

        vm.prank(alice);
        redemption.redeem(10_000e18, 0, RedemptionController.RedemptionMode.Normal);

        assertGe(vault.currentBacking(), backingBefore);
    }
}
