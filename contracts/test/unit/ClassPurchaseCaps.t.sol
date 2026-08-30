// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { PrimaryOffering } from "../../src/offering/PrimaryOffering.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-028: per-investor-class subscription caps. `investorClass` in the identity registry is
///         the source of truth — 1 retail, 2 accredited, 3 institutional.
contract ClassPurchaseCapsTest is ArcReserveTestBase {
    uint8 internal constant RETAIL = 1;
    uint8 internal constant ACCREDITED = 2;
    uint8 internal constant INSTITUTIONAL = 3;

    uint256 internal constant RETAIL_CAP = 5_000e6;
    uint256 internal constant ACCREDITED_CAP = 50_000e6;

    address internal institution = makeAddr("institution");

    function setUp() public override {
        super.setUp();
        _verify(institution);
        identityRegistry.updateInvestorClass(bob, ACCREDITED);
        identityRegistry.updateInvestorClass(institution, INSTITUTIONAL);
    }

    /// @dev The demo configuration from D-028.
    function _setDemoLimits() internal {
        offering.setClassLimit(RETAIL, RETAIL_CAP, 0);
        offering.setClassLimit(ACCREDITED, ACCREDITED_CAP, 0);
        offering.setClassLimit(INSTITUTIONAL, type(uint256).max, 0);
    }

    // -----------------------------------------------------------------
    // Class resolution
    // -----------------------------------------------------------------

    function test_classComesFromTheIdentityRegistry() public view {
        assertEq(offering.investorClassOf(alice), RETAIL);
        assertEq(offering.investorClassOf(bob), ACCREDITED);
        assertEq(offering.investorClassOf(institution), INSTITUTIONAL);
        assertEq(offering.investorClassOf(attacker), 0); // never registered
    }

    // -----------------------------------------------------------------
    // Nothing changes until a class is configured
    // -----------------------------------------------------------------

    function test_unconfiguredClassesFallBackToTheGlobalLimit() public view {
        assertEq(offering.effectiveWalletLimit(alice), 50_000e6);
        assertEq(offering.effectiveWalletLimit(institution), 50_000e6);
    }

    function test_withoutClassLimitsTheGlobalLimitStillBinds() public {
        musd.faucet(alice, 60_000e6);
        vm.startPrank(alice);
        musd.approve(address(offering), 60_000e6);
        vm.expectRevert(PrimaryOffering.WalletLimitExceeded.selector);
        offering.buy(50_001e6, 0);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------

    function test_setClassLimitStoresAndEmits() public {
        vm.expectEmit(true, false, false, true, address(offering));
        emit PrimaryOffering.ClassLimitSet(RETAIL, RETAIL_CAP, 20_000e6);
        offering.setClassLimit(RETAIL, RETAIL_CAP, 20_000e6);

        (uint256 walletLimit, uint256 aggregateCap, bool configured) = offering.classLimits(RETAIL);
        assertEq(walletLimit, RETAIL_CAP);
        assertEq(aggregateCap, 20_000e6);
        assertTrue(configured);
    }

    function test_onlyAdminCanSetClassLimits() public {
        bytes32 adminRole = offering.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        offering.setClassLimit(RETAIL, RETAIL_CAP, 0);
    }

    // -----------------------------------------------------------------
    // Per-wallet caps
    // -----------------------------------------------------------------

    function test_retailIsCappedAtItsClassLimit() public {
        _setDemoLimits();
        assertEq(offering.effectiveWalletLimit(alice), RETAIL_CAP);

        _buy(alice, RETAIL_CAP); // exactly at the cap succeeds
        assertEq(token.balanceOf(alice), 5_000e18);

        musd.faucet(alice, 1e6);
        vm.startPrank(alice);
        musd.approve(address(offering), 1e6);
        vm.expectRevert(PrimaryOffering.ClassWalletLimitExceeded.selector);
        offering.buy(1e6, 0);
        vm.stopPrank();
    }

    function test_accreditedGetsTheLargerCap() public {
        _setDemoLimits();
        assertEq(offering.effectiveWalletLimit(bob), ACCREDITED_CAP);
        _buy(bob, 40_000e6);
        assertEq(token.balanceOf(bob), 40_000e18);
    }

    /// @dev The reason a configured class limit replaces the global one rather than stacking with
    ///      it: stacking would cap an institution at the 50,000 global limit, which is the opposite
    ///      of "uncapped".
    function test_institutionalIsUncappedAboveTheGlobalLimit() public {
        _setDemoLimits();
        assertEq(offering.effectiveWalletLimit(institution), type(uint256).max);

        _buy(institution, 60_000e6); // above the 50,000 global wallet limit
        assertEq(token.balanceOf(institution), 60_000e18);
    }

    function test_theFundraisingCapStillBoundsAnUncappedClass() public {
        _setDemoLimits();
        musd.faucet(institution, 100_000e6);
        vm.startPrank(institution);
        musd.approve(address(offering), 100_000e6);
        vm.expectRevert(PrimaryOffering.FundraisingCapExceeded.selector);
        offering.buy(80_001e6, 0);
        vm.stopPrank();
    }

    function test_purchasesAccumulateTowardTheClassCap() public {
        _setDemoLimits();
        _buy(alice, 3_000e6);
        _buy(alice, 2_000e6); // reaches exactly 5,000

        musd.faucet(alice, 1e6);
        vm.startPrank(alice);
        musd.approve(address(offering), 1e6);
        vm.expectRevert(PrimaryOffering.ClassWalletLimitExceeded.selector);
        offering.buy(1e6, 0);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // Aggregate caps
    // -----------------------------------------------------------------

    function test_classAggregateCapLimitsTheWholeClass() public {
        // Retail may take at most 8,000 of the raise, whatever any one wallet's cap is.
        offering.setClassLimit(RETAIL, RETAIL_CAP, 8_000e6);
        address retailTwo = makeAddr("retailTwo");
        _verify(retailTwo);

        _buy(alice, 5_000e6);
        _buy(retailTwo, 3_000e6); // class total now exactly 8,000
        assertEq(offering.raisedByClass(RETAIL), 8_000e6);

        address retailThree = makeAddr("retailThree");
        _verify(retailThree);
        musd.faucet(retailThree, 1e6);
        vm.startPrank(retailThree);
        musd.approve(address(offering), 1e6);
        vm.expectRevert(PrimaryOffering.ClassAggregateCapExceeded.selector);
        offering.buy(1e6, 0);
        vm.stopPrank();
    }

    function test_aggregateCapDoesNotConstrainOtherClasses() public {
        offering.setClassLimit(RETAIL, RETAIL_CAP, 5_000e6);
        offering.setClassLimit(ACCREDITED, ACCREDITED_CAP, 0);

        _buy(alice, 5_000e6); // retail class is now full
        _buy(bob, 40_000e6); // accredited is unaffected
        assertEq(offering.raisedByClass(ACCREDITED), 40_000e6);
    }

    function test_raisedByClassTracksEachClassSeparately() public {
        _setDemoLimits();
        _buy(alice, 5_000e6);
        _buy(bob, 10_000e6);
        _buy(institution, 20_000e6);

        assertEq(offering.raisedByClass(RETAIL), 5_000e6);
        assertEq(offering.raisedByClass(ACCREDITED), 10_000e6);
        assertEq(offering.raisedByClass(INSTITUTIONAL), 20_000e6);
        assertEq(offering.stablecoinRaised(), 35_000e6);
    }

    // -----------------------------------------------------------------
    // remainingAllowance: the number a UI should show
    // -----------------------------------------------------------------

    function test_remainingAllowanceUsesTheClassLimit() public {
        _setDemoLimits();
        assertEq(offering.remainingAllowance(alice), RETAIL_CAP);
        _buy(alice, 2_000e6);
        assertEq(offering.remainingAllowance(alice), 3_000e6);
    }

    function test_remainingAllowanceIsBoundedByTheAggregateCap() public {
        offering.setClassLimit(RETAIL, RETAIL_CAP, 3_000e6);
        // Wallet cap says 5,000 but the class may only take 3,000 in total.
        assertEq(offering.remainingAllowance(alice), 3_000e6);
    }

    function test_remainingAllowanceIsBoundedByTheRaise() public {
        _setDemoLimits();
        _buy(institution, 78_000e6);
        // 2,000 of the 80,000 raise is left, less than the retail wallet cap.
        assertEq(offering.remainingAllowance(alice), 2_000e6);
    }

    function test_remainingAllowanceFallsBackToTheGlobalLimit() public view {
        assertEq(offering.remainingAllowance(alice), 50_000e6);
    }

    function test_remainingAllowanceIsZeroWhenTheCapIsReached() public {
        _setDemoLimits();
        _buy(alice, RETAIL_CAP);
        assertEq(offering.remainingAllowance(alice), 0);
    }
}
