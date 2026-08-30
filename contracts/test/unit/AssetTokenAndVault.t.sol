// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { MockReentrantUSD } from "../../src/mocks/MockReentrantUSD.sol";

contract AssetTokenAndVaultTest is ArcReserveTestBase {
    function testTokenPermitMetadataAndSupplyCap() public {
        AssetToken capped = new AssetToken(
            "Solar Indonesia 01", "SOLAR01", assetId, address(registry), 100e18, address(this)
        );
        capped.grantRole(capped.ISSUANCE_CONTROLLER_ROLE(), address(this));
        capped.mint(alice, 100e18);
        vm.expectRevert(AssetToken.MaximumSupplyExceeded.selector);
        capped.mint(alice, 1);
        assertEq(capped.maximumSupply(), 100e18);
        assertEq(capped.assetId(), assetId);
        assertEq(capped.nonces(alice), 0);
    }

    function testUnauthorizedMintAndPausedTransfer() public {
        _buy(alice, 10e6);
        vm.prank(attacker);
        vm.expectRevert();
        token.mint(attacker, 1e18);

        token.pause();
        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 1e18);
    }

    /// @notice D-023 capitalisation at settlement: 65% issuer / 30% reserve / 5% market.
    function testPrimarySaleAccountingUsesExactSixtyFiveThirtyFiveSplit() public {
        _buy(alice, 10_000e6);
        assertEq(vault.issuerProceeds(), 6_500e6);
        assertEq(vault.redemptionReserve(), 23_000e6); // 20,000 seed + 3,000 holdback
        assertEq(vault.marketMakingAllocation(), 500e6);
        assertEq(vault.totalAccounted(), vault.totalStablecoinBalance());
        assertEq(token.balanceOf(alice), 10_000e18);
    }

    function testIssuerCannotWithdrawProtectedReserve() public {
        uint256 beforeReserve = vault.redemptionReserve();
        vm.expectRevert(AssetVault.InsufficientCategoryBalance.selector);
        vault.withdrawIssuerProceeds(1);
        assertEq(vault.redemptionReserve(), beforeReserve);
    }

    function testMarketAllocationRequiresMinimumReserve() public {
        _buy(alice, 50_000e6);
        uint256 marketAllocation = vault.marketMakingAllocation();
        vm.prank(attacker);
        vm.expectRevert();
        vault.withdrawMarketAllocation(marketAllocation);
        assertTrue(vault.isSolvent());
    }

    function testVaultRejectsReentrantReserveDeposit() public {
        MockReentrantUSD malicious = new MockReentrantUSD();
        AssetVault guardedVault = new AssetVault(
            address(malicious),
            address(token),
            address(registry),
            assetId,
            address(this),
            2_000,
            address(this)
        );
        malicious.mint(address(this), 100e6);
        malicious.approve(address(guardedVault), type(uint256).max);
        malicious.arm(
            address(guardedVault), abi.encodeCall(AssetVault.depositInitialReserve, (1e6))
        );

        guardedVault.depositInitialReserve(100e6);

        assertFalse(malicious.reentrySucceeded());
        assertEq(guardedVault.redemptionReserve(), 100e6);
        assertEq(guardedVault.totalStablecoinBalance(), 100e6);
    }
}
