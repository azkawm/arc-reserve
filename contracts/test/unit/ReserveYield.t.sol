// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { MockYieldSource } from "../../src/mocks/MockYieldSource.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-023 reserve yield. Yield earned on the protected reserve stays with the reserve while
///         backing is behind schedule and belongs to the issuer once it is on or ahead.
contract ReserveYieldTest is ArcReserveTestBase {
    uint256 internal constant YIELD = 1_000e6;

    MockYieldSource internal yieldSource;
    uint64 internal scheduleStart;
    uint64 internal scheduleMaturity;

    function setUp() public override {
        super.setUp();
        _buy(alice, 50_000e6); // backing 0.60
        scheduleStart = uint64(block.timestamp);
        scheduleMaturity = registry.maturityOf(assetId);

        yieldSource = new MockYieldSource(address(musd), address(vault));
        vault.grantRole(vault.YIELD_SOURCE_ROLE(), address(yieldSource));
        musd.faucet(address(yieldSource), 10_000e6);
    }

    function _goBehindSchedule() internal {
        vault.setReserveSchedule(600_000, 1_000_000, scheduleStart, scheduleMaturity, 30 days);
        vm.warp(block.timestamp + 365 days);
        assertTrue(vault.isBehindSchedule());
    }

    function _stayOnSchedule() internal {
        vault.setReserveSchedule(100_000, 200_000, scheduleStart, scheduleMaturity, 30 days);
        assertFalse(vault.isBehindSchedule());
    }

    // -----------------------------------------------------------------
    // Routing
    // -----------------------------------------------------------------

    function test_behindScheduleYieldStaysWithTheReserve() public {
        _goBehindSchedule();
        uint256 reserveBefore = vault.redemptionReserve();
        uint256 proceedsBefore = vault.issuerProceeds();

        yieldSource.accrue(YIELD);

        assertEq(vault.redemptionReserve() - reserveBefore, YIELD);
        assertEq(vault.issuerProceeds(), proceedsBefore);
    }

    function test_onScheduleYieldBelongsToTheIssuer() public {
        _stayOnSchedule();
        uint256 reserveBefore = vault.redemptionReserve();
        uint256 proceedsBefore = vault.issuerProceeds();

        yieldSource.accrue(YIELD);

        assertEq(vault.redemptionReserve(), reserveBefore);
        assertEq(vault.issuerProceeds() - proceedsBefore, YIELD);
    }

    /// @dev The conservative default. Forgetting to configure a schedule must not silently route
    ///      the investors' reserve yield to the issuer.
    function test_withoutAScheduleYieldStaysWithTheReserve() public {
        uint256 reserveBefore = vault.redemptionReserve();
        uint256 proceedsBefore = vault.issuerProceeds();

        yieldSource.accrue(YIELD);

        assertEq(vault.redemptionReserve() - reserveBefore, YIELD);
        assertEq(vault.issuerProceeds(), proceedsBefore);
    }

    function test_routingFollowsScheduleStatePerCall() public {
        _goBehindSchedule();
        yieldSource.accrue(YIELD);
        uint256 reserveAfterFirst = vault.redemptionReserve();

        // Cure the shortfall, then accrue again: the destination flips with no admin action.
        uint256 needed = vault.targetBackingNow() * 50_000 - vault.redemptionReserve() + 1e6;
        musd.faucet(address(this), needed);
        musd.approve(address(vault), needed);
        vault.depositReserve(needed, 1);
        assertFalse(vault.isBehindSchedule());

        uint256 proceedsBefore = vault.issuerProceeds();
        yieldSource.accrue(YIELD);
        assertEq(vault.issuerProceeds() - proceedsBefore, YIELD);
        assertEq(vault.redemptionReserve(), reserveAfterFirst + needed);
    }

    function test_yieldCanCureAShortfall() public {
        _goBehindSchedule();
        uint256 needed = vault.targetBackingNow() * 50_000 - vault.redemptionReserve() + 1e6;
        musd.faucet(address(yieldSource), needed);

        yieldSource.accrue(needed);

        assertFalse(vault.isBehindSchedule());
        assertEq(vault.shortfallSince(), 0);
    }

    // -----------------------------------------------------------------
    // Events and accounting
    // -----------------------------------------------------------------

    function test_emitsAccrualWithDestination() public {
        _goBehindSchedule();
        uint256 expected = vault.redemptionReserve() + YIELD;

        vm.expectEmit(true, false, false, true, address(vault));
        emit AssetVault.ReserveYieldAccrued(address(yieldSource), YIELD, true, expected);
        yieldSource.accrue(YIELD);
    }

    function test_yieldKeepsTheVaultSolvent() public {
        _goBehindSchedule();
        yieldSource.accrue(YIELD);
        assertGe(vault.totalStablecoinBalance(), vault.totalAccounted());
    }

    function test_yieldRaisesBackingForHolders() public {
        _goBehindSchedule();
        uint256 backingBefore = vault.currentBacking();
        yieldSource.accrue(YIELD);
        // 1,000 mUSD over 50,000 investor tokens is +0.02 of backing.
        assertEq(vault.currentBacking(), backingBefore + 20_000);
    }

    // -----------------------------------------------------------------
    // Authorization and guards
    // -----------------------------------------------------------------

    function test_onlyYieldSourceRoleCanAccrue() public {
        bytes32 role = vault.YIELD_SOURCE_ROLE();
        musd.faucet(attacker, YIELD);
        vm.startPrank(attacker);
        musd.approve(address(vault), YIELD);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role
            )
        );
        vault.accrueReserveYield(YIELD);
        vm.stopPrank();
    }

    function test_accrualIsBlockedWhilePaused() public {
        vault.pause();
        vm.expectRevert();
        yieldSource.accrue(YIELD);
    }

    function test_mockRejectsMoreThanItHolds() public {
        vm.expectRevert(MockYieldSource.NothingToAccrue.selector);
        yieldSource.accrue(999_000e6);
    }

    function test_mockRejectsZero() public {
        vm.expectRevert(MockYieldSource.NothingToAccrue.selector);
        yieldSource.accrue(0);
    }

    function test_mockReportsWhatItCanPay() public view {
        assertEq(yieldSource.available(), 10_000e6);
    }
}
