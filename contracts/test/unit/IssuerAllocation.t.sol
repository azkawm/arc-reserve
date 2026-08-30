// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-024: the disclosed issuer/company allocation is non-redeemable and sits outside the
///         backing denominator. Covers the running total, every denominator that switched, the
///         redemption block in all three modes, and the paused-burn preview fix.
contract IssuerAllocationTest is ArcReserveTestBase {
    address internal company = makeAddr("company");

    uint256 internal constant COMPANY_ALLOCATION = 20_000e18;

    function setUp() public override {
        super.setUp();
        _verify(company);
        // Mint the company allocation the way the local script does: flag first, then mint, so
        // the running total is picked up by `_update` rather than by the setter's balance sweep.
        token.setIssuerAllocation(company, true);
        token.grantRole(token.ISSUANCE_CONTROLLER_ROLE(), address(this));
        token.mint(company, COMPANY_ALLOCATION);
        token.revokeRole(token.ISSUANCE_CONTROLLER_ROLE(), address(this));
    }

    // -----------------------------------------------------------------
    // Running total
    // -----------------------------------------------------------------

    function test_mintIntoFlaggedAddressExcludedFromInvestorSupply() public view {
        assertEq(token.totalSupply(), COMPANY_ALLOCATION);
        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION);
        assertEq(token.investorSupply(), 0);
    }

    function test_investorPurchaseAddsOnlyToInvestorSupply() public {
        _buy(alice, 10_000e6);
        assertEq(token.totalSupply(), COMPANY_ALLOCATION + 10_000e18);
        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION);
        assertEq(token.investorSupply(), 10_000e18);
    }

    function test_flaggingAfterMintSweepsExistingBalance() public {
        _buy(alice, 10_000e6);
        assertEq(token.investorSupply(), 10_000e18);

        token.setIssuerAllocation(alice, true);
        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION + 10_000e18);
        assertEq(token.investorSupply(), 0);
    }

    function test_unflaggingReturnsBalanceToInvestorSupply() public {
        token.setIssuerAllocation(company, false);
        assertEq(token.issuerAllocationSupply(), 0);
        assertEq(token.investorSupply(), COMPANY_ALLOCATION);
    }

    function test_reflaggingIsIdempotent() public {
        token.setIssuerAllocation(company, true);
        token.setIssuerAllocation(company, true);
        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION);
    }

    /// @dev The vesting release path: once the company sells to a verified investor those tokens
    ///      become investor supply, which lowers backing per token for everyone. See the D-024 /
    ///      D-025 note in SYSTEM_SPEC before relying on backing being monotonic.
    function test_transferOutOfFlaggedAddressIncreasesInvestorSupply() public {
        vm.prank(company);
        token.transfer(alice, 5_000e18);

        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION - 5_000e18);
        assertEq(token.investorSupply(), 5_000e18);
        assertEq(token.totalSupply(), COMPANY_ALLOCATION);
    }

    function test_transferBetweenFlaggedAddressesLeavesTotalUnchanged() public {
        address companyTwo = makeAddr("companyTwo");
        _verify(companyTwo);
        token.setIssuerAllocation(companyTwo, true);

        vm.prank(company);
        token.transfer(companyTwo, 5_000e18);

        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION);
        assertEq(token.investorSupply(), 0);
    }

    function test_transferIntoFlaggedAddressReducesInvestorSupply() public {
        _buy(alice, 10_000e6);
        vm.prank(alice);
        token.transfer(company, 4_000e18);

        assertEq(token.issuerAllocationSupply(), COMPANY_ALLOCATION + 4_000e18);
        assertEq(token.investorSupply(), 6_000e18);
    }

    function test_onlyAdminCanFlagIssuerAllocation() public {
        // Read the role before pranking: an external call inside the `expectRevert` argument
        // would consume the prank and the call would run as the admin.
        bytes32 adminRole = token.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        token.setIssuerAllocation(attacker, true);
    }

    function test_cannotFlagZeroAddress() public {
        vm.expectRevert(AssetToken.InvalidAddress.selector);
        token.setIssuerAllocation(address(0), true);
    }

    // -----------------------------------------------------------------
    // Redemption is blocked in every mode
    // -----------------------------------------------------------------

    function test_flaggedHolderCannotRedeemNormal() public {
        _buy(alice, 10_000e6);
        vm.prank(company);
        vm.expectRevert(RedemptionController.IssuerAllocationCannotRedeem.selector);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
    }

    function test_flaggedHolderCannotRedeemAtMaturity() public {
        _buy(alice, 10_000e6);
        vm.warp(registry.maturityOf(assetId));
        registry.markMatured(assetId);

        vm.prank(company);
        vm.expectRevert(RedemptionController.IssuerAllocationCannotRedeem.selector);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Maturity);
    }

    function test_flaggedHolderCannotRedeemInEmergency() public {
        _buy(alice, 10_000e6);
        registry.suspendAsset(assetId);
        registry.markDefault(assetId);

        vm.prank(company);
        vm.expectRevert(RedemptionController.IssuerAllocationCannotRedeem.selector);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Emergency);
    }

    /// @dev The block follows the address, not the tokens: a verified buyer of vested company
    ///      tokens redeems normally.
    function test_buyerOfVestedTokensCanRedeem() public {
        _buy(alice, 10_000e6);
        vm.prank(company);
        token.transfer(bob, 1_000e18);

        vm.prank(bob);
        uint256 paid = redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertGt(paid, 0);
    }

    function test_unflaggedCompanyCanRedeem() public {
        _buy(alice, 10_000e6);
        token.setIssuerAllocation(company, false);

        vm.prank(company);
        uint256 paid = redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertGt(paid, 0);
    }

    // -----------------------------------------------------------------
    // Denominators
    // -----------------------------------------------------------------

    function test_minimumRequiredReserveExcludesIssuerAllocation() public {
        _buy(alice, 10_000e6);
        // NAV is 1e6 and the ratio is 20%, so only the 10,000 investor tokens are backed:
        // 10,000 * 1.000000 * 20% = 2,000 mUSD, not 30,000 * 20% = 6,000.
        assertEq(vault.minimumRequiredReserve(), 2_000e6);
    }

    function test_reserveRatioBpsExcludesIssuerAllocation() public {
        _buy(alice, 10_000e6);
        // Reserve is 20,000 initial + 20% of the 10,000 mUSD raise = 22,000 against 10,000
        // investor tokens at NAV 1.0 => 220%.
        assertEq(vault.reserveRatioBps(), 22_000);
    }

    function test_outstandingObligationsExcludeIssuerAllocation() public {
        _buy(alice, 10_000e6);
        assertEq(redemption.outstandingTokenObligations(), 10_000e18);
        assertEq(token.totalSupply(), COMPANY_ALLOCATION + 10_000e18);
    }

    function test_redemptionPriceUsesInvestorSupply() public {
        _buy(alice, 10_000e6);
        // Backing per investor token is 22,000 / 10,000 = 2.20, above NAV, so NAV caps the price.
        assertEq(redemption.redemptionPrice(RedemptionController.RedemptionMode.Normal), 1e6);

        // Unflagging the company spreads the same reserve over 30,000 tokens (0.733), which now
        // sits below NAV and becomes the binding constraint. Same reserve, different denominator.
        token.setIssuerAllocation(company, false);
        uint256 spread = redemption.redemptionPrice(RedemptionController.RedemptionMode.Normal);
        assertLt(spread, 1e6);
        uint256 expected = uint256(22_000e6) * 1e18 / uint256(30_000e18);
        assertEq(spread, expected);
    }

    // -----------------------------------------------------------------
    // F-1: paused redemption preview
    // -----------------------------------------------------------------

    function test_transferRestrictionDoesNotReportPauseForRedemptionBurn() public {
        _buy(alice, 10_000e6);
        token.pause();
        // A burn is the redemption exit and is exempt from the pause inside `_update`, so the
        // preview must not tell the UI the redemption is blocked.
        assertEq(token.transferRestriction(alice, address(0), 1_000e18), bytes4(0));
    }

    function test_pausedRedemptionBurnActuallySucceeds() public {
        _buy(alice, 10_000e6);
        token.pause();
        vm.prank(alice);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertEq(token.balanceOf(alice), 9_000e18);
    }

    function test_transferRestrictionStillReportsPauseForOrdinaryTransfer() public {
        _buy(alice, 10_000e6);
        token.pause();
        assertEq(token.transferRestriction(alice, bob, 1_000e18), Pausable.EnforcedPause.selector);
    }
}
