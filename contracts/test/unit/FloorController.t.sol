// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { FloorController } from "../../src/market/FloorController.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-025: the published protected floor ratchets up one tick spacing at a time and never
///         above `min(NAV, backing)` at the moment it moves. It is a reference, not a bid.
contract FloorControllerTest is ArcReserveTestBase {
    /// @dev ~0.2983 mUSD per token in the demo pool's tick space.
    int24 internal constant LOW_TICK = 288_420;
    /// @dev ~0.9727, chosen so it sits just above the demo market-floor range.
    int24 internal constant NEAR_TICK = 276_600;

    FloorController internal floor;
    bool internal t0;
    int24 internal spacing;

    function setUp() public override {
        super.setUp();
        _buy(alice, 50_000e6); // backing 0.70, NAV 1.00 => ceiling 0.70
        t0 = market.assetIsToken0();
        spacing = market.tickSpacing();
        floor = _newFloor(_signed(LOW_TICK), 0);
    }

    /// @dev The demo pool prices the asset above tick 0 in one ordering and below it in the other.
    function _signed(int24 magnitude) internal view returns (int24) {
        return t0 ? -magnitude : magnitude;
    }

    function _newFloor(int24 initialTick, uint64 cooldown) internal returns (FloorController) {
        return new FloorController(
            address(vault),
            address(registry),
            assetId,
            t0,
            spacing,
            initialTick,
            cooldown,
            address(this)
        );
    }

    // -----------------------------------------------------------------
    // Price mapping and direction
    // -----------------------------------------------------------------

    function test_floorPriceIsSixDecimalMusd() public view {
        assertApproxEqAbs(floor.floorPrice(), 298_335, 10);
    }

    function test_nextTickMovesInThePriceUpDirection() public view {
        int24 next = floor.nextTick();
        assertEq(next, t0 ? floor.floorTick() + spacing : floor.floorTick() - spacing);
        // Whatever the token ordering, the next candidate is a higher price.
        assertGt(floor.priceAtTick(next), floor.floorPrice());
    }

    function test_priceMatchesTheMarketManagerConvention() public view {
        // Both quote 6-decimal mUSD per whole asset token, so they are directly comparable.
        assertApproxEqRel(floor.priceAtTick(_signed(276_300)), 1e6, 0.01e18);
    }

    // -----------------------------------------------------------------
    // Level-up
    // -----------------------------------------------------------------

    function test_levelUpAdvancesExactlyOneSpacing() public {
        int24 before = floor.floorTick();
        floor.levelUp();
        assertEq(floor.floorTick(), t0 ? before + spacing : before - spacing);
    }

    function test_levelUpIsPermissionless() public {
        vm.prank(attacker);
        floor.levelUp();
        assertEq(floor.lastLevelUpAt(), uint64(block.timestamp));
    }

    function test_levelUpEmitsTheMoveWithItsInputs() public {
        int24 before = floor.floorTick();
        int24 next = floor.nextTick();
        (uint256 nav, uint256 backing,) = floor.ceilingParts();

        vm.expectEmit(false, false, false, true, address(floor));
        emit FloorController.FloorLevelUp(before, next, floor.priceAtTick(next), backing, nav);
        floor.levelUp();
    }

    function test_levelUpRespectsTheCooldown() public {
        FloorController paced = _newFloor(_signed(LOW_TICK), 30 minutes);
        paced.levelUp();

        vm.expectRevert(FloorController.CooldownActive.selector);
        paced.levelUp();

        vm.warp(block.timestamp + 30 minutes);
        paced.levelUp();
    }

    function test_levelUpRequiresAnActiveAsset() public {
        registry.suspendAsset(assetId);
        vm.expectRevert(FloorController.AssetNotActive.selector);
        floor.levelUp();
    }

    /// @dev The core property: the floor climbs to the ceiling and stops there, one step per call.
    function test_floorClimbsToTheCeilingAndStops() public {
        (,, uint256 ceiling) = floor.ceilingParts();
        uint256 steps;
        while (floor.canLevelUp()) {
            floor.levelUp();
            steps++;
            assertLe(floor.floorPrice(), ceiling); // never overshoots
            if (steps > 500) break; // guard against a runaway loop
        }
        assertGt(steps, 100); // 0.2983 -> 0.70 at ~0.6% a step
        assertLe(floor.floorPrice(), ceiling);
        assertGt(floor.priceAtTick(floor.nextTick()), ceiling);

        vm.expectRevert(FloorController.FloorCeilingExceeded.selector);
        floor.levelUp();
    }

    function test_backingIsTheBindingCeilingWhenBelowNav() public {
        (uint256 nav, uint256 backing, uint256 ceiling) = floor.ceilingParts();
        assertEq(nav, 1e6);
        assertEq(backing, 700_000);
        assertEq(ceiling, 700_000);
    }

    function test_moreReserveRaisesTheCeilingAndUnblocksTheClimb() public {
        FloorController near = _newFloor(_signed(NEAR_TICK), 0);
        // 0.9727 is above the 0.70 ceiling, so no step is available.
        assertFalse(near.canLevelUp());

        // Fund the reserve past 1.00 backing; NAV is now the binding constraint.
        musd.faucet(address(this), 30_000e6);
        musd.approve(address(vault), 30_000e6);
        vault.depositReserve(30_000e6, 1);

        (,, uint256 ceiling) = near.ceilingParts();
        assertEq(ceiling, 1e6); // NAV caps it
        assertTrue(near.canLevelUp());
    }

    function test_noInvestorSupplyMeansNoCeilingAndNoClimb() public {
        vm.prank(alice);
        redemption.redeem(25_000e18, 0, RedemptionController.RedemptionMode.Normal);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        redemption.redeem(25_000e18, 0, RedemptionController.RedemptionMode.Normal);

        assertEq(token.investorSupply(), 0);
        (,, uint256 ceiling) = floor.ceilingParts();
        assertEq(ceiling, 0);
        assertFalse(floor.canLevelUp());
    }

    // -----------------------------------------------------------------
    // NAV markdown: the honest case
    // -----------------------------------------------------------------

    /// @dev A markdown can leave a previously valid level above the new NAV. D-025 pauses the
    ///      ratchet rather than lowering the published floor, so the level must stay put and the
    ///      contract must report that it is no longer covered.
    function test_navMarkdownPausesTheRatchetWithoutLoweringTheFloor() public {
        while (floor.canLevelUp()) {
            floor.levelUp();
        }
        int24 settled = floor.floorTick();
        uint256 settledPrice = floor.floorPrice();
        assertTrue(floor.isFloorCovered());

        // Walk NAV down below the settled floor. The registry caps each update at 20%, so this
        // takes three steps - which is itself the point: a markdown is gradual and observable.
        registry.publishNAV(assetId, 850_000);
        registry.publishNAV(assetId, 720_000);
        registry.publishNAV(assetId, 600_000);
        assertLt(600_000, settledPrice);

        // The published level does not retreat...
        assertEq(floor.floorTick(), settled);
        assertEq(floor.floorPrice(), settledPrice);
        // ...it is reported as no longer covered, and the ratchet is paused.
        assertFalse(floor.isFloorCovered());
        assertFalse(floor.canLevelUp());
        vm.expectRevert(FloorController.FloorCeilingExceeded.selector);
        floor.levelUp();
    }

    function test_navMarkdownIsReportedAsUncovered() public {
        FloorController near = _newFloor(_signed(NEAR_TICK), 0);
        // Floor 0.9727 against a 0.70 ceiling: published but not currently covered.
        assertFalse(near.isFloorCovered());
        assertFalse(near.canLevelUp());
        // The level does not retreat.
        assertEq(near.floorTick(), _signed(NEAR_TICK));
    }

    function test_floorNeverExceedsBackingWhileActive() public {
        while (floor.canLevelUp()) {
            floor.levelUp();
        }
        // `floorPrice <= backing` is permanent, because backing never falls while Active.
        assertLe(floor.floorPrice(), vault.currentBacking());
    }

    // -----------------------------------------------------------------
    // Administration
    // -----------------------------------------------------------------

    function test_cooldownIsAdminSettable() public {
        floor.setFloorLevelCooldown(1 hours);
        assertEq(floor.floorLevelCooldown(), 1 hours);
    }

    function test_onlyAdminCanSetCooldown() public {
        bytes32 adminRole = floor.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        floor.setFloorLevelCooldown(1 hours);
    }

    function test_constructorRejectsUnalignedTick() public {
        vm.expectRevert(FloorController.InvalidTick.selector);
        _newFloor(_signed(LOW_TICK) + 1, 0);
    }

    // -----------------------------------------------------------------
    // rebalanceToFloor
    // -----------------------------------------------------------------

    /// @dev The shared base fixture mirrors position ticks by magnitude, which inverts their price
    ///      meaning for the token1 ordering. These tests care specifically about price direction,
    ///      so they configure their own ranges: the market-floor position starts just below the
    ///      published level in price terms, whichever way the pool is ordered.
    function _configureFloorPositions() internal {
        if (t0) {
            market.configureCorePositions(-278_400, -277_200, -276_600, -276_000);
        } else {
            market.configureCorePositions(277_200, 278_400, 276_000, 276_600);
        }
    }

    function test_rebalanceToFloorRequiresAControllerBinding() public {
        _configureFloorPositions();
        (int24 lower, int24 upper) = _lowerRange();
        vm.expectRevert(AssetMarketManager.FloorControllerNotSet.selector);
        market.rebalanceToFloor(lower, upper);
    }

    /// @dev A range one spacing further from the published level, in price terms.
    function _lowerRange() internal view returns (int24 lower, int24 upper) {
        return t0 ? (int24(-279_000), int24(-277_800)) : (int24(277_800), int24(279_000));
    }

    /// @dev A range whose highest price sits above the published level.
    function _aboveRange() internal view returns (int24 lower, int24 upper) {
        return t0 ? (int24(-277_800), int24(-276_000)) : (int24(276_000), int24(277_800));
    }

    function test_rebalanceToFloorAcceptsARangeAtOrBelowTheFloor() public {
        _configureFloorPositions();
        FloorController near = _newFloor(_signed(NEAR_TICK), 0);
        market.setFloorController(address(near));

        // Highest price of the new range sits below the published floor.
        (int24 lower, int24 upper) = _lowerRange();
        market.rebalanceToFloor(lower, upper);

        (int24 storedLower, int24 storedUpper,,) =
            market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        assertEq(storedLower, lower);
        assertEq(storedUpper, upper);
    }

    function test_rebalanceToFloorRejectsARangeAboveTheFloor() public {
        _configureFloorPositions();
        FloorController near = _newFloor(_signed(NEAR_TICK), 0);
        market.setFloorController(address(near));

        // Highest price of the new range sits above the published floor.
        (int24 lower, int24 upper) = _aboveRange();
        vm.expectRevert(AssetMarketManager.RangeAboveFloor.selector);
        market.rebalanceToFloor(lower, upper);
    }

    function test_onlyKeeperCanRebalanceToFloor() public {
        _configureFloorPositions();
        FloorController near = _newFloor(_signed(NEAR_TICK), 0);
        market.setFloorController(address(near));

        (int24 lower, int24 upper) = _lowerRange();
        bytes32 keeperRole = market.KEEPER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, keeperRole
            )
        );
        market.rebalanceToFloor(lower, upper);
    }

    function test_onlyAdminCanBindTheController() public {
        bytes32 adminRole = market.DEFAULT_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, adminRole
            )
        );
        market.setFloorController(address(floor));
    }
}
