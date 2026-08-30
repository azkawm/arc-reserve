// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-023 residual return. A note pays at most par at maturity; reserve above what remaining
///         holders can still claim goes back to the issuer once the asset is closed and the
///         maturity window has passed.
contract ResidualReserveTest is ArcReserveTestBase {
    uint64 internal constant WINDOW = 90 days;

    uint64 internal scheduleStart;
    uint64 internal assetMaturity;

    function setUp() public override {
        super.setUp();
        _buy(alice, 50_000e6); // 50,000 tokens, reserve 30,000 => backing 0.60
        scheduleStart = uint64(block.timestamp);
        assetMaturity = registry.maturityOf(assetId);
        vault.setReserveSchedule(600_000, 1_000_000, scheduleStart, assetMaturity, 30 days);
        vault.setMaturityWindow(WINDOW);
    }

    /// @dev Fund the reserve well past par so there is a real residual to return.
    function _overfundToPar(uint256 extra) internal {
        uint256 needed = 50_000e6 - vault.redemptionReserve() + extra;
        musd.faucet(address(this), needed);
        musd.approve(address(vault), needed);
        vault.depositReserve(needed, 1);
    }

    function _mature() internal {
        vm.warp(assetMaturity);
        registry.markMatured(assetId);
    }

    function _close() internal {
        registry.closeAsset(assetId);
    }

    // -----------------------------------------------------------------
    // Par cap on maturity redemption
    // -----------------------------------------------------------------

    function test_maturityRedemptionIsCappedAtPar() public {
        _overfundToPar(10_000e6); // backing now 1.20
        assertEq(vault.currentBacking(), 1_200_000);
        _mature();

        // Backing is 1.20 and NAV is 1.00, but par is 1.00 - the note pays par, not backing.
        assertEq(redemption.redemptionPrice(RedemptionController.RedemptionMode.Maturity), 1e6);
    }

    function test_normalRedemptionIsNotParCapped() public {
        _overfundToPar(10_000e6);
        // Normal mode still uses min(NAV, backing); NAV is the binding constraint here.
        assertEq(redemption.redemptionPrice(RedemptionController.RedemptionMode.Normal), 1e6);
        assertEq(vault.maturityParValue(), 1_000_000);
    }

    function test_underfundedMaturityStillPaysBackingNotPar() public {
        _mature();
        // Backing 0.60 is below par, so backing binds.
        assertEq(redemption.redemptionPrice(RedemptionController.RedemptionMode.Maturity), 600_000);
    }

    // -----------------------------------------------------------------
    // The window
    // -----------------------------------------------------------------

    function test_windowEndsAtMaturityPlusWindow() public view {
        assertEq(vault.maturityWindowEndsAt(), assetMaturity + WINDOW);
    }

    function test_holdersCanRedeemInsideTheWindow() public {
        _overfundToPar(10_000e6);
        _mature();
        vm.warp(assetMaturity + WINDOW - 1);

        vm.prank(alice);
        uint256 paid = redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Maturity);
        assertEq(paid, 1_000e6); // par
    }

    function test_maturityRedemptionClosesAfterTheWindow() public {
        _overfundToPar(10_000e6);
        _mature();
        vm.warp(assetMaturity + WINDOW + 1);

        vm.prank(alice);
        vm.expectRevert(RedemptionController.MaturityWindowClosed.selector);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Maturity);
    }

    function test_withoutAWindowMaturityRedemptionStaysOpen() public {
        vault.setMaturityWindow(0);
        _overfundToPar(10_000e6);
        _mature();
        vm.warp(assetMaturity + 10 * 365 days);

        assertEq(vault.maturityWindowEndsAt(), 0);
        vm.prank(alice);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Maturity);
    }

    // -----------------------------------------------------------------
    // Residual arithmetic
    // -----------------------------------------------------------------

    function test_residualIsReserveAboveParObligations() public {
        _overfundToPar(10_000e6);
        // 60,000 reserve against 50,000 tokens at par 1.00 => 10,000 residual.
        assertEq(vault.redemptionReserve(), 60_000e6);
        assertEq(vault.outstandingObligationsAtPar(), 50_000e6);
        assertEq(vault.residualReserve(), 10_000e6);
    }

    function test_underfundedAssetHasNoResidual() public view {
        // Reserve 30,000 against 50,000 tokens at par => obligations exceed reserve.
        assertEq(vault.residualReserve(), 0);
    }

    function test_redemptionsShrinkObligationsAndGrowResidual() public {
        _overfundToPar(10_000e6);
        _mature();
        vm.prank(alice);
        redemption.redeem(10_000e18, 0, RedemptionController.RedemptionMode.Maturity);

        // 10,000 tokens burned at par: reserve 50,000, obligations 40,000, residual unchanged.
        assertEq(vault.redemptionReserve(), 50_000e6);
        assertEq(vault.outstandingObligationsAtPar(), 40_000e6);
        assertEq(vault.residualReserve(), 10_000e6);
    }

    // -----------------------------------------------------------------
    // Release
    // -----------------------------------------------------------------

    function test_releaseRequiresClosedStatus() public {
        _overfundToPar(10_000e6);
        _mature();
        vm.warp(assetMaturity + WINDOW + 1);

        vm.expectRevert(AssetVault.AssetNotClosed.selector);
        vault.releaseResidualReserve();
    }

    function test_releaseRequiresTheWindowToHavePassed() public {
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW - 1);

        vm.expectRevert(AssetVault.MaturityWindowOpen.selector);
        vault.releaseResidualReserve();
    }

    function test_releaseWithNoWindowConfiguredIsRefused() public {
        vault.setMaturityWindow(0);
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + 10 * 365 days);

        // No window means holders can always redeem, so there is no point at which the reserve is
        // safely surplus.
        vm.expectRevert(AssetVault.MaturityWindowOpen.selector);
        vault.releaseResidualReserve();
    }

    function test_onlyIssuerCanRelease() public {
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW + 1);

        vm.prank(attacker);
        vm.expectRevert(AssetVault.UnauthorizedIssuer.selector);
        vault.releaseResidualReserve();
    }

    function test_releasePaysTheIssuerAndRetainsParCover() public {
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW + 1);

        uint256 issuerBefore = musd.balanceOf(address(this));
        vm.expectEmit(true, false, false, true, address(vault));
        emit AssetVault.ResidualReserveReleased(address(this), 10_000e6, 50_000e6);
        uint256 released = vault.releaseResidualReserve();

        assertEq(released, 10_000e6);
        assertEq(musd.balanceOf(address(this)) - issuerBefore, 10_000e6);
        // Every remaining holder still has full par cover.
        assertEq(vault.redemptionReserve(), 50_000e6);
        assertEq(vault.redemptionReserve(), vault.outstandingObligationsAtPar());
        assertEq(vault.residualReserve(), 0);
    }

    function test_releaseIsRefusedTwice() public {
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW + 1);
        vault.releaseResidualReserve();

        vm.expectRevert(AssetVault.NothingToRelease.selector);
        vault.releaseResidualReserve();
    }

    function test_releaseIsRefusedWhenUnderfunded() public {
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW + 1);

        vm.expectRevert(AssetVault.NothingToRelease.selector);
        vault.releaseResidualReserve();
    }

    function test_releaseKeepsTheVaultSolvent() public {
        _overfundToPar(10_000e6);
        _mature();
        _close();
        vm.warp(assetMaturity + WINDOW + 1);
        vault.releaseResidualReserve();

        assertGe(vault.totalStablecoinBalance(), vault.totalAccounted());
    }

    function test_onlyAdminCanSetTheWindow() public {
        bytes32 adminRole = vault.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        vault.setMaturityWindow(30 days);
    }
}
