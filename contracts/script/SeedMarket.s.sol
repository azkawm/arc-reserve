// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { PrimaryOffering } from "../src/offering/PrimaryOffering.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";

/// @title SeedMarket
/// @notice Puts the first liquidity into a deployed ArcReserve market. Chains with a REAL pool
///         land with zero liquidity, because `DeployTestnet` deliberately does not seed one.
///
/// @dev    WHY DEPLOYMENT DOES NOT DO THIS. On the mock pool `mint` charges `liquidity x 1` of
///         both tokens regardless of range, so seeding is arithmetic. On a real pool `L` is not
///         an amount: the same `L` costs wildly different amounts at different ranges, and a
///         range entirely on one side of spot costs ONE token. Baking that into the deploy script
///         would put untested liquidity math on the critical path of a deployment that already
///         has to clear a per-transaction gas cap.
///
///         WHICH POSITION TO SEED, and this is the part that is easy to get wrong. The manager's
///         `creditableSurplus()` is `max(0, mUSD balance - principalOutstanding)`. `fundFromVault`
///         raises BOTH, so it nets to zero — correct, the manager has earned nothing yet. But mUSD
///         then deployed into a position LEAVES the balance while remaining in the basis, so the
///         manager reads as under water and credits nothing until trading earns the draw back.
///
///         - `Discovery` sits above spot and costs ASSET ONLY. The drawn mUSD stays free, so the
///           first buy converts inventory straight into creditable surplus and the flywheel is
///           visible immediately. This is the default.
///         - `ReserveFloor` sits below spot and costs STABLE ONLY. It provides the bid that the
///           D-037 sell path needs — but it consumes the basis, so no surplus appears until
///           trades have recovered it. Opt in with `SEED_RESERVE_FLOOR=true` and size it knowing
///           that.
///         - `Anchor` straddles spot and costs both.
///
///         Measured on a real pool at the demo ranges, `L = 1e16` costs roughly 573 SOLAR01
///         (discovery), 849 mUSD (reserve floor), or 161 SOLAR01 + 137 mUSD (anchor).
///
///         Usage (addresses are read from deployments/<chainId>.json):
///           PRIVATE_KEY=0x… forge script script/SeedMarket.s.sol:SeedMarket \
///             --rpc-url $RPC --broadcast --slow
contract SeedMarket is Script {
    uint128 private constant DEFAULT_LIQUIDITY = 1e16;
    uint256 private constant DEFAULT_PURCHASE = 5_000e6;
    uint256 private constant DEFAULT_INVENTORY = 2_000e18;

    function run() external {
        require(
            block.chainid == 31_337 || block.chainid == 84_532 || block.chainid == 296
                || block.chainid == 5_042_002,
            "SeedMarket: testnets only (D-027)"
        );
        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(privateKey != 0, "SeedMarket: PRIVATE_KEY is required");
        address operator = vm.addr(privateKey);

        string memory raw =
            vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        MockUSD musd = MockUSD(vm.parseJsonAddress(raw, ".mockUSD"));
        AssetToken token = AssetToken(vm.parseJsonAddress(raw, ".token"));
        AssetVault vault = AssetVault(vm.parseJsonAddress(raw, ".vault"));
        PrimaryOffering offering = PrimaryOffering(vm.parseJsonAddress(raw, ".offering"));
        AssetMarketManager market = AssetMarketManager(vm.parseJsonAddress(raw, ".marketManager"));

        uint128 liquidity = uint128(vm.envOr("SEED_LIQUIDITY", uint256(DEFAULT_LIQUIDITY)));
        uint256 purchase = vm.envOr("SEED_PURCHASE", DEFAULT_PURCHASE);
        bool seedFloor = vm.envOr("SEED_RESERVE_FLOOR", false);

        vm.startBroadcast(privateKey);

        // 1. A purchase is the only thing that creates market allocation: the D-023 split sends
        //    5% of each primary sale to it. With no purchases the vault has nothing to lend the
        //    market, so seeding cannot even begin.
        if (vault.marketMakingAllocation() == 0) {
            musd.faucet(operator, purchase);
            musd.approve(address(offering), purchase);
            offering.buy(purchase, 0);
        }

        // 2. Draw the market's own allocation, and move asset inventory in. `fundTokenInventory`
        //    is a transfer, not a loan — it does not touch `principalOutstanding`.
        uint256 allocation = vault.marketMakingAllocation();
        if (allocation > 0) market.fundFromVault(allocation);
        uint256 inventory =
            _min(vm.envOr("SEED_INVENTORY", DEFAULT_INVENTORY), token.balanceOf(operator));
        if (inventory > 0) {
            token.approve(address(market), inventory);
            market.fundTokenInventory(inventory);
        }

        // 3. Discovery first, asset-only, so the cost basis stays intact.
        _seed(market, AssetMarketManager.PositionKind.Discovery, liquidity);
        if (seedFloor) _seed(market, AssetMarketManager.PositionKind.ReserveFloor, liquidity);

        vm.stopBroadcast();

        (,, uint128 discoveryL,) = market.positions(AssetMarketManager.PositionKind.Discovery);
        (,, uint128 floorL,) = market.positions(AssetMarketManager.PositionKind.ReserveFloor);
        console2.log("Market seeded on chain", block.chainid);
        console2.log("  discovery liquidity :", discoveryL);
        console2.log("  floor liquidity     :", floorL);
        console2.log("  principalOutstanding:", market.principalOutstanding());
        console2.log("  creditableSurplus   :", market.creditableSurplus());
        console2.log("Buy SOLAR01 via AssetMarketManager.swapExactInput to turn the flywheel.");
    }

    function _seed(
        AssetMarketManager market,
        AssetMarketManager.PositionKind kind,
        uint128 liquidity
    ) private {
        (,, uint128 existing, bool configured) = market.positions(kind);
        require(configured, "SeedMarket: position not configured");
        if (existing != 0) return; // already seeded; re-running is a no-op
        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: kind,
                liquidity: liquidity,
                maxAmount0: type(uint128).max,
                maxAmount1: type(uint128).max,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
