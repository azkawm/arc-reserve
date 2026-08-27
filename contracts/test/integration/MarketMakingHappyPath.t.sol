// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";

/// @notice Hikari-inspired lifecycle coverage for ArcReserve's capped-inventory liquidity engine.
/// @dev These tests cover range lifecycle semantics, not Hikari's minting or bonding-curve math.
contract MarketMakingHappyPathTest is ArcReserveTestBase {
    uint128 private constant FLOOR_LIQUIDITY = 40e6;
    uint128 private constant ANCHOR_LIQUIDITY = 60e6;
    uint128 private constant DISCOVERY_LIQUIDITY = 50e6;

    uint256 private protectedReserve;

    function setUp() public override {
        super.setUp();
        _buy(alice, 20_000e6);
        _configurePositions();

        protectedReserve = vault.redemptionReserve();
        market.fundFromVault(600e6);

        vm.startPrank(alice);
        token.approve(address(market), 600e18);
        market.fundTokenInventory(600e18);
        vm.stopPrank();

        _addPosition(AssetMarketManager.PositionKind.ReserveFloor, FLOOR_LIQUIDITY);
        _addPosition(AssetMarketManager.PositionKind.Anchor, ANCHOR_LIQUIDITY);
        _addPosition(AssetMarketManager.PositionKind.Discovery, DISCOVERY_LIQUIDITY);
    }

    function testHappyPath1SlideMovesAnchorUpAndRemints() public {
        (int24 floorLower, int24 floorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        (int24 oldLower, int24 oldUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        (int24 discoveryLower, int24 discoveryUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Discovery);
        _assertAllPositionsFunded(
            floorLower, floorUpper, oldLower, oldUpper, discoveryLower, discoveryUpper
        );

        uint256 stableInventoryBefore = musd.balanceOf(address(market));
        uint256 tokenInventoryBefore = token.balanceOf(address(market));
        _removePosition(AssetMarketManager.PositionKind.Anchor, ANCHOR_LIQUIDITY);
        assertEq(_poolLiquidity(oldLower, oldUpper), 0, "old anchor must be empty");

        _setOneDollarOracle(10);
        int24 upwardShift = market.assetIsToken0() ? int24(60) : int24(-60);
        int24 newLower = oldLower + upwardShift;
        int24 newUpper = oldUpper + upwardShift;
        market.slide(newLower, newUpper);

        _assertPosition(AssetMarketManager.PositionKind.Anchor, newLower, newUpper, 0);
        assertEq(market.lastRebalanceAt(), block.timestamp, "slide timestamp");

        _addPosition(AssetMarketManager.PositionKind.Anchor, ANCHOR_LIQUIDITY);
        _assertPosition(
            AssetMarketManager.PositionKind.Anchor, newLower, newUpper, ANCHOR_LIQUIDITY
        );
        assertEq(_poolLiquidity(newLower, newUpper), ANCHOR_LIQUIDITY, "new anchor liquidity");
        _assertPosition(
            AssetMarketManager.PositionKind.ReserveFloor, floorLower, floorUpper, FLOOR_LIQUIDITY
        );
        _assertPosition(
            AssetMarketManager.PositionKind.Discovery,
            discoveryLower,
            discoveryUpper,
            DISCOVERY_LIQUIDITY
        );
        _assertNoInventoryOrReserveLeak(stableInventoryBefore, tokenInventoryBefore);
    }

    function testHappyPath2SweepMovesAnchorDownAndRemints() public {
        (int24 floorLower, int24 floorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        (int24 oldLower, int24 oldUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        (int24 discoveryLower, int24 discoveryUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Discovery);
        _assertAllPositionsFunded(
            floorLower, floorUpper, oldLower, oldUpper, discoveryLower, discoveryUpper
        );

        uint256 stableInventoryBefore = musd.balanceOf(address(market));
        uint256 tokenInventoryBefore = token.balanceOf(address(market));
        _removePosition(AssetMarketManager.PositionKind.Anchor, ANCHOR_LIQUIDITY);
        assertEq(_poolLiquidity(oldLower, oldUpper), 0, "old anchor must be empty");

        _setOneDollarOracle(-10);
        int24 downwardShift = market.assetIsToken0() ? int24(-60) : int24(60);
        int24 newLower = oldLower + downwardShift;
        int24 newUpper = oldUpper + downwardShift;
        market.sweep(newLower, newUpper);

        _assertPosition(AssetMarketManager.PositionKind.Anchor, newLower, newUpper, 0);
        assertEq(market.lastRebalanceAt(), block.timestamp, "sweep timestamp");

        _addPosition(AssetMarketManager.PositionKind.Anchor, ANCHOR_LIQUIDITY);
        _assertPosition(
            AssetMarketManager.PositionKind.Anchor, newLower, newUpper, ANCHOR_LIQUIDITY
        );
        assertEq(_poolLiquidity(newLower, newUpper), ANCHOR_LIQUIDITY, "new anchor liquidity");
        _assertPosition(
            AssetMarketManager.PositionKind.ReserveFloor, floorLower, floorUpper, FLOOR_LIQUIDITY
        );
        _assertPosition(
            AssetMarketManager.PositionKind.Discovery,
            discoveryLower,
            discoveryUpper,
            DISCOVERY_LIQUIDITY
        );
        _assertNoInventoryOrReserveLeak(stableInventoryBefore, tokenInventoryBefore);
    }

    function testHappyPath3RefreshesDiscoveryUpAndRemints() public {
        (int24 floorLower, int24 floorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        (int24 oldLower, int24 oldUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Discovery);
        _assertAllPositionsFunded(
            floorLower, floorUpper, anchorLower, anchorUpper, oldLower, oldUpper
        );

        uint256 stableInventoryBefore = musd.balanceOf(address(market));
        uint256 tokenInventoryBefore = token.balanceOf(address(market));
        _removePosition(AssetMarketManager.PositionKind.Discovery, DISCOVERY_LIQUIDITY);
        assertEq(_poolLiquidity(oldLower, oldUpper), 0, "old discovery must be empty");

        _setOneDollarOracle(10);
        int24 upwardShift = market.assetIsToken0() ? int24(120) : int24(-120);
        int24 newLower = oldLower + upwardShift;
        int24 newUpper = oldUpper + upwardShift;
        market.refreshDiscovery(newLower, newUpper);

        _assertPosition(AssetMarketManager.PositionKind.Discovery, newLower, newUpper, 0);
        assertEq(market.lastRebalanceAt(), block.timestamp, "discovery refresh timestamp");

        _addPosition(AssetMarketManager.PositionKind.Discovery, DISCOVERY_LIQUIDITY);
        _assertPosition(
            AssetMarketManager.PositionKind.Discovery, newLower, newUpper, DISCOVERY_LIQUIDITY
        );
        assertEq(_poolLiquidity(newLower, newUpper), DISCOVERY_LIQUIDITY, "new discovery liquidity");
        _assertPosition(
            AssetMarketManager.PositionKind.ReserveFloor, floorLower, floorUpper, FLOOR_LIQUIDITY
        );
        _assertPosition(
            AssetMarketManager.PositionKind.Anchor, anchorLower, anchorUpper, ANCHOR_LIQUIDITY
        );
        _assertNoInventoryOrReserveLeak(stableInventoryBefore, tokenInventoryBefore);
    }

    function _assertAllPositionsFunded(
        int24 floorLower,
        int24 floorUpper,
        int24 anchorLower,
        int24 anchorUpper,
        int24 discoveryLower,
        int24 discoveryUpper
    ) private view {
        _assertPosition(
            AssetMarketManager.PositionKind.ReserveFloor, floorLower, floorUpper, FLOOR_LIQUIDITY
        );
        _assertPosition(
            AssetMarketManager.PositionKind.Anchor, anchorLower, anchorUpper, ANCHOR_LIQUIDITY
        );
        _assertPosition(
            AssetMarketManager.PositionKind.Discovery,
            discoveryLower,
            discoveryUpper,
            DISCOVERY_LIQUIDITY
        );
        assertEq(_poolLiquidity(floorLower, floorUpper), FLOOR_LIQUIDITY, "floor pool liquidity");
        assertEq(
            _poolLiquidity(anchorLower, anchorUpper), ANCHOR_LIQUIDITY, "anchor pool liquidity"
        );
        assertEq(
            _poolLiquidity(discoveryLower, discoveryUpper),
            DISCOVERY_LIQUIDITY,
            "discovery pool liquidity"
        );
        assertEq(vault.redemptionReserve(), protectedReserve, "protected reserve changed");
    }

    function _assertNoInventoryOrReserveLeak(
        uint256 stableInventoryBefore,
        uint256 tokenInventoryBefore
    ) private view {
        assertEq(musd.balanceOf(address(market)), stableInventoryBefore, "stable inventory leak");
        assertEq(token.balanceOf(address(market)), tokenInventoryBefore, "token inventory leak");
        assertEq(vault.redemptionReserve(), protectedReserve, "protected reserve changed");
    }

    function _assertPosition(
        AssetMarketManager.PositionKind kind,
        int24 expectedLower,
        int24 expectedUpper,
        uint128 expectedLiquidity
    ) private view {
        (int24 lower, int24 upper, uint128 liquidity, bool configured) = market.positions(kind);
        assertTrue(configured, "position not configured");
        assertEq(lower, expectedLower, "unexpected lower tick");
        assertEq(upper, expectedUpper, "unexpected upper tick");
        assertEq(liquidity, expectedLiquidity, "unexpected position liquidity");
    }

    function _addPosition(AssetMarketManager.PositionKind kind, uint128 liquidity) private {
        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: kind,
                liquidity: liquidity,
                maxAmount0: liquidity,
                maxAmount1: liquidity,
                minimumAmount0: liquidity,
                minimumAmount1: liquidity,
                deadline: block.timestamp
            })
        );
    }

    function _removePosition(AssetMarketManager.PositionKind kind, uint128 liquidity) private {
        market.removeLiquidity(kind, liquidity, liquidity, liquidity, block.timestamp);
    }

    function _poolLiquidity(int24 lower, int24 upper) private view returns (uint128) {
        return pool.liquidityOf(keccak256(abi.encode(address(market), lower, upper)));
    }
}
