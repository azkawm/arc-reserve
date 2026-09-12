// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-035: the accounting and authority around the market-surplus crossing.
/// @dev    The crossing itself — trade, harvest, credit, ratchet — is proven end to end against
///         canonical Uniswap in `test/fork/BaseSepoliaMarket.t.sol`. It cannot be proven here: the
///         mock pool has no curve, so it never converts a position's inventory from one token to
///         the other, which is the step that *creates* the surplus. What this file pins is
///         everything around it — the cost basis, the cap, who may cross, and that the crossing is
///         one-way.
///
///         Note the D-033 inflow gate carries `creditMarketSurplus` too, but is unreachable for it
///         in practice: the market manager only exists once phase 2 has activated the asset, so
///         the `Approved` window it guards can never contain a call from this path. It is there
///         for consistency, not because a route exists.
contract MarketFlywheelTest is ArcReserveTestBase {
    function setUp() public override {
        super.setUp();
        _buy(alice, 20_000e6); // 5% of the raise lands in the market allocation
        _configurePositions();
    }

    // -----------------------------------------------------------------
    // Cost basis
    // -----------------------------------------------------------------

    function test_principalOutstandingTracksWhatWasDrawn() public {
        assertEq(market.principalOutstanding(), 0);

        market.fundFromVault(600e6);
        assertEq(market.principalOutstanding(), 600e6);

        market.returnStablecoinToVault(250e6);
        assertEq(market.principalOutstanding(), 350e6);
    }

    /// @dev Returning more than was drawn clears the basis rather than reverting on underflow.
    function test_returningMoreThanDrawnSaturatesAtZero() public {
        market.fundFromVault(100e6);
        musd.faucet(address(market), 500e6); // market earned more than it borrowed
        market.returnStablecoinToVault(400e6);
        assertEq(market.principalOutstanding(), 0);
    }

    // -----------------------------------------------------------------
    // The cap
    // -----------------------------------------------------------------

    /// @dev The whole point of the basis: money drawn from the vault is NOT surplus. A manager
    ///      holding exactly what it borrowed has earned nothing and may credit nothing.
    function test_drawnPrincipalIsNeverCreditable() public {
        market.fundFromVault(600e6);
        assertEq(musd.balanceOf(address(market)), 600e6);
        assertEq(market.creditableSurplus(), 0, "borrowed capital must not read as surplus");
    }

    function test_onlyWhatTheMarketReturnedAbovePrincipalIsCreditable() public {
        market.fundFromVault(600e6);
        musd.faucet(address(market), 175e6); // stands in for inventory sold / fees collected
        assertEq(market.creditableSurplus(), 175e6);
    }

    /// @dev Stable locked inside pool positions is not in the manager's balance, so an under-water
    ///      manager reads zero rather than over-crediting. Conservative by construction.
    function test_anUnderwaterManagerReadsZeroRatherThanNegative() public {
        market.fundFromVault(600e6);
        vm.prank(address(market));
        musd.transfer(address(0xdead), 400e6); // as if deployed into a position
        assertEq(market.creditableSurplus(), 0);
    }

    // -----------------------------------------------------------------
    // Authority
    // -----------------------------------------------------------------

    function test_onlyTheMarketManagerMayCreditSurplus() public {
        musd.faucet(attacker, 100e6);
        bytes32 role = vault.MARKET_MANAGER_ROLE();

        vm.startPrank(attacker);
        musd.approve(address(vault), 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role
            )
        );
        vault.creditMarketSurplus(100e6);
        vm.stopPrank();
    }

    /// @dev Not a keeper action and not an admin action — `address(this)` is protocol admin and
    ///      keeper here, and still cannot cross capital into the reserve.
    function test_noteEvenTheProtocolAdminMayCreditSurplus() public {
        musd.faucet(address(this), 100e6);
        musd.approve(address(vault), 100e6);
        bytes32 role = vault.MARKET_MANAGER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), role
            )
        );
        vault.creditMarketSurplus(100e6);
    }

    // -----------------------------------------------------------------
    // The crossing
    // -----------------------------------------------------------------

    function test_creditingSurplusRaisesTheReserveAndBacking() public {
        uint256 reserveBefore = vault.redemptionReserve();
        uint256 backingBefore = vault.currentBacking();
        uint256 accountedBefore = vault.totalAccounted();

        musd.faucet(address(market), 500e6);
        vm.startPrank(address(market));
        musd.approve(address(vault), 500e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit AssetVault.MarketSurplusCredited(address(market), 500e6, reserveBefore + 500e6);
        vault.creditMarketSurplus(500e6);
        vm.stopPrank();

        assertEq(vault.redemptionReserve(), reserveBefore + 500e6);
        assertEq(vault.totalAccounted(), accountedBefore + 500e6);
        assertGt(vault.currentBacking(), backingBefore, "backing must rise with the reserve");
        assertTrue(vault.isSolvent());
        assertEq(vault.totalStablecoinBalance(), vault.totalAccounted());
    }

    /// @dev The non-negotiable property: capital crosses INTO the reserve and never back out.
    ///      `withdrawMarketAllocation` draws from a different bucket, so a reserve swollen by
    ///      surplus cannot be pulled back to fund trading.
    function test_theCrossingIsOneWay() public {
        musd.faucet(address(market), 5_000e6);
        vm.startPrank(address(market));
        musd.approve(address(vault), 5_000e6);
        vault.creditMarketSurplus(5_000e6);
        vm.stopPrank();

        uint256 allocation = vault.marketMakingAllocation();
        assertGt(vault.redemptionReserve(), allocation, "reserve should dwarf the allocation");

        // Anything beyond the market allocation is refused, however large the reserve is.
        vm.prank(address(market));
        vm.expectRevert(AssetVault.InsufficientCategoryBalance.selector);
        vault.withdrawMarketAllocation(allocation + 1);
    }
}
