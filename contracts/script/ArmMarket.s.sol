// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";
import { IUniswapV3Pool } from "../src/interfaces/IUniswapV3Pool.sol";

/// @title ArmMarket
/// @notice Keeper action that turns an empty or stale market into a TWO-WAY market: an anchor that
///         straddles spot and is funded on both sides, plus a discovery range above spot for the
///         D-035 flywheel.
///
/// @dev    WHY THIS EXISTS. Phase B-1 harvests the WHOLE discovery position after every swap and
///         does not re-mint (that is deferred Phase B-2). A discovery-only market therefore allows
///         exactly one buy, after which every swap reverts `InvalidSwapDirection()`. Sells never
///         work at all, because discovery holds asset only. Both live testnets were in that state on
///         2026-09-13. The anchor is not harvested, so funding it gives continuous trading in both
///         directions near spot.
///
///         WHY IT TAKES TWO RUNS. `slide`/`sweep` and `refreshDiscovery` each start the rebalance
///         cooldown, and a simulation executes every call at one timestamp, so both in one run would
///         revert `SafetyCheckFailed(Cooldown)`. `addLiquidity` does not check the cooldown. Each
///         run therefore does the next step only: first move and fund the anchor, then (on a later
///         run, after the cooldown) move and fund discovery. A third run reports nothing to do.
///
///         RANGES. The anchor is re-centred on spot, 5 tick spacings each side. Discovery sits
///         directly beyond the anchor on the asset-price-UP side, 20 spacings wide, so it holds asset
///         only and the first buy into it produces creditable surplus. Orientation follows
///         `assetIsToken0`. Each endpoint may move at most `maxTickShift`; a larger move reverts
///         here with a message rather than inside the manager.
///
///         COST BASIS. The anchor consumes mUSD, which leaves the manager's balance while staying in
///         `principalOutstanding`. The manager then reads as under water until trading earns the
///         draw back, so early flywheel turns credit only the surplus above that basis. This is
///         correct and conservative; do not expect the first harvest to credit the full trade.
///
///         Usage (addresses from deployments/<chainId>.json; broadcasting needs the keeper key):
///           PRIVATE_KEY=0x… forge script script/ArmMarket.s.sol:ArmMarket --rpc-url $RPC \
///             --broadcast --slow [--gas-estimate-multiplier 200 on Hedera]
///         ANCHOR_LIQUIDITY / DISCOVERY_LIQUIDITY override the default L of 1e16 each.
contract ArmMarket is Script {
    int24 private constant ANCHOR_HALF_WIDTH_SPACINGS = 5;
    int24 private constant DISCOVERY_WIDTH_SPACINGS = 20;
    uint256 private constant DEFAULT_LIQUIDITY = 1e16;

    struct Ctx {
        AssetMarketManager market;
        IUniswapV3Pool pool;
        int24 spot;
        int24 spacing;
        bool assetIsToken0;
        address token0;
        address token1;
    }

    function run() external {
        require(
            block.chainid == 31_337 || block.chainid == 84_532 || block.chainid == 296
                || block.chainid == 5_042_002,
            "ArmMarket: testnets only (D-027)"
        );
        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(privateKey != 0, "ArmMarket: PRIVATE_KEY is required");

        Ctx memory c = _context();
        console2.log("ArmMarket on chain", block.chainid);
        console2.log("  spot tick", int256(c.spot));

        (,, uint128 anchorLiquidity,) = c.market.positions(AssetMarketManager.PositionKind.Anchor);
        (,, uint128 discoveryLiquidity,) =
            c.market.positions(AssetMarketManager.PositionKind.Discovery);

        vm.startBroadcast(privateKey);
        if (anchorLiquidity == 0) {
            _armAnchor(c);
            vm.stopBroadcast();
            console2.log("Anchor armed. Run again after the rebalance cooldown to arm discovery.");
        } else if (discoveryLiquidity == 0) {
            _armDiscovery(c);
            vm.stopBroadcast();
            console2.log("Discovery armed. The market is two-way.");
        } else {
            vm.stopBroadcast();
            console2.log("Anchor and discovery both hold liquidity; nothing to do.");
        }
        console2.log("  principalOutstanding", c.market.principalOutstanding());
        console2.log("  creditableSurplus   ", c.market.creditableSurplus());
    }

    function _context() private view returns (Ctx memory c) {
        string memory json =
            vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        c.market = AssetMarketManager(vm.parseJsonAddress(json, ".marketManager"));
        c.pool = IUniswapV3Pool(vm.parseJsonAddress(json, ".pool"));
        address token = vm.parseJsonAddress(json, ".token");
        address musd = vm.parseJsonAddress(json, ".mockUSD");
        (, c.spot,,,,,) = c.pool.slot0();
        c.spacing = c.market.tickSpacing();
        c.assetIsToken0 = c.market.assetIsToken0();
        if (c.assetIsToken0) {
            c.token0 = token;
            c.token1 = musd;
        } else {
            c.token0 = musd;
            c.token1 = token;
        }
    }

    function _armAnchor(Ctx memory c) private {
        (int24 lower, int24 upper,,) = c.market.positions(AssetMarketManager.PositionKind.Anchor);
        int24 centre = _floorToSpacing(c.spot, c.spacing);
        int24 newLower = centre - ANCHOR_HALF_WIDTH_SPACINGS * c.spacing;
        int24 newUpper = centre + ANCHOR_HALF_WIDTH_SPACINGS * c.spacing;

        // Mirror AssetMarketManager._spotLeftAnchor, in price terms.
        bool leftUp = c.assetIsToken0 ? c.spot > upper : c.spot < lower;
        bool leftDown = c.assetIsToken0 ? c.spot < lower : c.spot > upper;
        if (leftUp || leftDown) {
            _requireShift(c.market, lower, newLower);
            _requireShift(c.market, upper, newUpper);
            if (leftUp) c.market.slide(newLower, newUpper);
            else c.market.sweep(newLower, newUpper);
            console2.log(
                string.concat(
                    "  anchor moved to ",
                    vm.toString(int256(newLower)),
                    " .. ",
                    vm.toString(int256(newUpper))
                )
            );
        } else {
            console2.log("  anchor already contains spot; funding in place");
        }
        _add(c, AssetMarketManager.PositionKind.Anchor, "ANCHOR_LIQUIDITY");
    }

    function _armDiscovery(Ctx memory c) private {
        (int24 anchorLower, int24 anchorUpper,,) =
            c.market.positions(AssetMarketManager.PositionKind.Anchor);
        (int24 lower, int24 upper,,) = c.market.positions(AssetMarketManager.PositionKind.Discovery);
        int24 width = DISCOVERY_WIDTH_SPACINGS * c.spacing;
        // Beyond the anchor on the asset-price-UP side, so the range holds asset only.
        int24 newLower;
        int24 newUpper;
        if (c.assetIsToken0) {
            newLower = anchorUpper;
            newUpper = anchorUpper + width;
        } else {
            newLower = anchorLower - width;
            newUpper = anchorLower;
        }
        require(
            c.assetIsToken0 ? newLower > c.spot : newUpper <= c.spot,
            "ArmMarket: discovery would not sit entirely above spot; re-arm the anchor first"
        );
        if (lower != newLower || upper != newUpper) {
            _requireShift(c.market, lower, newLower);
            _requireShift(c.market, upper, newUpper);
            c.market.refreshDiscovery(newLower, newUpper);
            console2.log(
                string.concat(
                    "  discovery moved to ",
                    vm.toString(int256(newLower)),
                    " .. ",
                    vm.toString(int256(newUpper))
                )
            );
        }
        _add(c, AssetMarketManager.PositionKind.Discovery, "DISCOVERY_LIQUIDITY");
    }

    function _add(Ctx memory c, AssetMarketManager.PositionKind kind, string memory envKey)
        private
    {
        uint128 liquidity = uint128(vm.envOr(envKey, DEFAULT_LIQUIDITY));
        (uint256 amount0, uint256 amount1) = c.market
            .addLiquidity(
                AssetMarketManager.AddLiquidityParams({
                    kind: kind,
                    liquidity: liquidity,
                    maxAmount0: IERC20(c.token0).balanceOf(address(c.market)),
                    maxAmount1: IERC20(c.token1).balanceOf(address(c.market)),
                    minimumAmount0: 0,
                    minimumAmount1: 0,
                    deadline: block.timestamp + 1 hours
                })
            );
        uint256 assetAmount = c.assetIsToken0 ? amount0 : amount1;
        uint256 stableAmount = c.assetIsToken0 ? amount1 : amount0;
        console2.log("  liquidity added", uint256(liquidity));
        console2.log("    asset  (SOLAR01 wei)", assetAmount);
        console2.log("    stable (mUSD 1e6)   ", stableAmount);
    }

    function _requireShift(AssetMarketManager market, int24 from, int24 to) private view {
        int256 moved = int256(from) - int256(to);
        if (moved < 0) moved = -moved;
        require(
            moved <= int256(market.maxTickShift()),
            "ArmMarket: range move exceeds maxTickShift; move it in steps"
        );
    }

    /// @dev Rounds toward negative infinity. Solidity's `%` takes the dividend's sign.
    function _floorToSpacing(int24 tick, int24 spacing) private pure returns (int24 aligned) {
        int24 remainder = tick % spacing;
        aligned = tick - remainder;
        if (remainder < 0) aligned -= spacing;
    }
}
