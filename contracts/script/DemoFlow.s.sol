// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { MockUniswapV3Pool } from "../src/mocks/MockUniswapV3Pool.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { PrimaryOffering } from "../src/offering/PrimaryOffering.sol";
import { RevenueDistributor } from "../src/revenue/RevenueDistributor.sol";
import { RedemptionController } from "../src/redemption/RedemptionController.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";
import { FloorController } from "../src/market/FloorController.sol";

/// @title  DemoFlow
/// @notice Drives a deployed Anvil chain through the whole asset lifecycle, so the backend indexer
///         and the frontend have real transactions and real events to read.
///
/// @dev    ANVIL ONLY, and opt-in. This is a **fixture generator, not a test** - correctness is
///         already covered by the 305-test suite, and `ArcReserveLifecycle.t.sol` runs this same
///         sequence in memory. What the suite cannot produce is chain state and an event stream, so
///         that is what this is for.
///
///         It must stay OUT of `DeployLocal`: `CONTRACTS_TO_BACKEND` §7 pins the untouched seed
///         (`totalSupply == 0`, every bucket 0, reserve 20,000e6) as the replay acceptance target.
///         Running this produces a deliberately different fixture, so the backend has to know which
///         of the two it is replaying against.
///
///         It deploys nothing, so `deployments/31337.json` is untouched - that file is the address
///         book, not a record of what happened. Transaction hashes land in
///         `broadcast/DemoFlow.s.sol/31337/run-latest.json`.
///
///         RUN WITH `--slow`. Without it, forge fires the transactions together, Anvil packs them
///         into a handful of blocks, and the hash-to-function pairing in the broadcast file comes
///         out wrong (observed 2026-09-12: 108,442 gas attributed to a call that used 8.5M).
///
///           forge script script/DemoFlow.s.sol:DemoFlow \
///             --rpc-url http://127.0.0.1:8545 --broadcast --slow
///
///         ORDER IS FORCED, not stylistic. Revenue cannot be deposited before a purchase exists
///         (`NoYieldEligibleSupply`), the market cannot be funded before a purchase routes 5% into
///         the allocation, and `levelUp` cannot fire at all while `investorSupply` is 0 - backing is
///         then 0, so the ceiling is `min(NAV, 0)` and every candidate level is refused.
contract DemoFlow is Script {
    // Anvil defaults. #0 is deployer / issuer / verifier / keeper; #1 is accredited (50,000 cap);
    // #2 is retail (5,000 cap under D-028).
    uint256 private constant PK_DEPLOYER =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 private constant PK_ACCREDITED =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 private constant PK_RETAIL =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    uint256 private constant ACCREDITED_BUY = 40_000e6;
    /// @dev Exactly the D-028 retail cap, so the limit is visibly binding without a revert.
    uint256 private constant RETAIL_BUY = 5_000e6;
    uint256 private constant REVENUE_DEPOSIT = 3_000e6;
    uint256 private constant MARKET_FUNDING = 2_000e6;
    uint256 private constant TOKEN_INVENTORY = 2_000e18;
    uint128 private constant POSITION_LIQUIDITY = 500e6;
    /// @dev Sized against the mock's sharpened impact to clear the 600-tick anchor band, and small
    ///      enough that the pool can pay the output side from what the three positions minted.
    uint256 private constant TRADE_SIZE = 1_000e6;
    uint256 private constant REDEEM_TOKENS = 5_000e18;

    MockUSD private musd;
    AssetToken private token;
    AssetVault private vault;
    PrimaryOffering private offering;
    RevenueDistributor private revenue;
    RedemptionController private redemption;
    AssetMarketManager private market;
    FloorController private floor;
    MockUniswapV3Pool private pool;

    address private accredited;
    address private retail;

    function run() external {
        require(block.chainid == 31_337, "DemoFlow: Anvil only");
        _load();
        accredited = vm.addr(PK_ACCREDITED);
        retail = vm.addr(PK_RETAIL);

        _purchases();
        _revenueAndClaims();
        _fundMarket();
        _addLiquidity();
        // Explicit level-up FIRST, while the floor's cooldown clock has never started. Run after
        // the trade instead and `levelUp()` reverts on `CooldownActive`, taking the script with it
        // — the flywheel's own attempt skips gracefully, but a direct call does not.
        _raiseFloor();
        _tradeAndTurnFlywheel();
        _rebalance();
        _redeem();
        _report();
    }

    function _load() private {
        string memory json = vm.readFile("deployments/31337.json");
        musd = MockUSD(vm.parseJsonAddress(json, ".mockUSD"));
        token = AssetToken(vm.parseJsonAddress(json, ".token"));
        vault = AssetVault(vm.parseJsonAddress(json, ".vault"));
        offering = PrimaryOffering(vm.parseJsonAddress(json, ".offering"));
        revenue = RevenueDistributor(vm.parseJsonAddress(json, ".revenueDistributor"));
        redemption = RedemptionController(vm.parseJsonAddress(json, ".redemptionController"));
        market = AssetMarketManager(vm.parseJsonAddress(json, ".marketManager"));
        floor = FloorController(vm.parseJsonAddress(json, ".floorController"));
        pool = MockUniswapV3Pool(vm.parseJsonAddress(json, ".pool"));
        require(token.totalSupply() == 0, "DemoFlow: chain already exercised - redeploy first");
    }

    /// @dev Two buyers, deliberately. One accredited and one retail gives the distributor two
    ///      claimants with different balances, and puts the D-028 cap on screen.
    function _purchases() private {
        vm.startBroadcast(PK_ACCREDITED);
        musd.faucet(accredited, ACCREDITED_BUY);
        musd.approve(address(offering), ACCREDITED_BUY);
        offering.buy(ACCREDITED_BUY, 0);
        vm.stopBroadcast();

        vm.startBroadcast(PK_RETAIL);
        musd.faucet(retail, RETAIL_BUY);
        musd.approve(address(offering), RETAIL_BUY);
        offering.buy(RETAIL_BUY, 0);
        vm.stopBroadcast();
    }

    /// @dev Must follow a purchase: `depositRevenue` reverts `NoYieldEligibleSupply` at zero supply.
    function _revenueAndClaims() private {
        vm.startBroadcast(PK_DEPLOYER);
        musd.faucet(vm.addr(PK_DEPLOYER), REVENUE_DEPOSIT);
        musd.approve(address(revenue), REVENUE_DEPOSIT);
        revenue.depositRevenue(REVENUE_DEPOSIT, 202_601, keccak256("demo-report-202601"));
        vm.stopBroadcast();

        vm.broadcast(PK_ACCREDITED);
        revenue.claimRevenue();

        vm.broadcast(PK_RETAIL);
        revenue.claimRevenue();
    }

    /// @dev The market allocation only exists because the purchases routed 5% into it.
    function _fundMarket() private {
        vm.broadcast(PK_DEPLOYER);
        market.fundFromVault(MARKET_FUNDING);

        // Inventory is transferred in, never minted - the manager has no issuance authority (D-003).
        vm.startBroadcast(PK_ACCREDITED);
        token.approve(address(market), TOKEN_INVENTORY);
        market.fundTokenInventory(TOKEN_INVENTORY);
        vm.stopBroadcast();
    }

    function _addLiquidity() private {
        vm.startBroadcast(PK_DEPLOYER);
        _mint(AssetMarketManager.PositionKind.ReserveFloor);
        _mint(AssetMarketManager.PositionKind.Anchor);
        _mint(AssetMarketManager.PositionKind.Discovery);
        vm.stopBroadcast();
    }

    function _mint(AssetMarketManager.PositionKind kind) private {
        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: kind,
                liquidity: POSITION_LIQUIDITY,
                maxAmount0: POSITION_LIQUIDITY,
                maxAmount1: POSITION_LIQUIDITY,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
    }

    /// @dev Permissionless (D-025). Possible only now that a purchase has created backing.
    function _raiseFloor() private {
        vm.broadcast(PK_DEPLOYER);
        floor.levelUp();
    }

    /// @dev D-035/D-037: a real user trade through the manager, which also moves the price and so
    ///      sets up the rebalance below — one action instead of a test setter.
    ///
    ///      **The flywheel will report `NO_SURPLUS` here, and that is correct on Anvil.** The mock
    ///      pool has no curve: a position's composition never converts from SOLAR01 into mUSD, and
    ///      that conversion is what *creates* surplus. A harvest against the mock returns exactly
    ///      what was minted, so there is nothing above principal to credit. The mechanism is still
    ///      exercised end to end — trade routes, price moves, discovery harvests, skip reasons are
    ///      emitted — but the *effect* on backing can only be shown against a real pool. It is, in
    ///      `test/fork/BaseSepoliaMarket.t.sol`: reserve 24,000 -> 24,630.32, backing 0.300000 ->
    ///      0.307879 from one trade. Do not "fix" this by faucetting mUSD to the manager; that
    ///      would manufacture a surplus that the mock has not earned.
    ///
    ///      `setSwapImpactForTest` sharpens the mock's linear price impact so a modest order clears
    ///      the 600-tick anchor band. Mock-only, and another thing a canonical pool decides for
    ///      itself from the curve.
    function _tradeAndTurnFlywheel() private {
        address trader = vm.addr(PK_RETAIL);
        vm.broadcast(PK_DEPLOYER);
        pool.setSwapImpactForTest(150e6, 600);

        vm.startBroadcast(PK_RETAIL);
        musd.faucet(trader, TRADE_SIZE);
        musd.approve(address(market), TRADE_SIZE);
        market.swapExactInput(address(musd), TRADE_SIZE, 0, block.timestamp + 1 hours);
        vm.stopBroadcast();
    }

    /// @dev D-036: `slide` needs spot to have LEFT the anchor range on the upside — which the trade
    ///      above just did, with an actual swap rather than `setOracleForTest`. The anchor must be
    ///      emptied first (D-015 remove -> move -> remint).
    function _rebalance() private {
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        int24 shift = market.assetIsToken0() ? int24(60) : int24(-60);

        vm.startBroadcast(PK_DEPLOYER);
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor,
            POSITION_LIQUIDITY,
            0,
            0,
            block.timestamp + 1 hours
        );
        market.slide(anchorLower + shift, anchorUpper + shift);
        _mint(AssetMarketManager.PositionKind.Anchor);
        vm.stopBroadcast();
    }

    /// @dev Partial on purpose: redeeming the whole position would leave `investorSupply` at 0,
    ///      which makes backing undefined and the floor uncovered - a poor state to hand a demo.
    function _redeem() private {
        vm.broadcast(PK_ACCREDITED);
        redemption.redeem(REDEEM_TOKENS, 0, RedemptionController.RedemptionMode.Normal);
    }

    function _report() private view {
        console2.log("=== DemoFlow complete ===");
        console2.log("token.totalSupply       ", token.totalSupply());
        console2.log("token.investorSupply    ", token.investorSupply());
        console2.log("vault.redemptionReserve ", vault.redemptionReserve());
        console2.log("vault.issuerProceeds    ", vault.issuerProceeds());
        console2.log("vault.marketAllocation  ", vault.marketMakingAllocation());
        console2.log("vault.protocolFees      ", vault.protocolFees());
        console2.log("vault.currentBacking    ", vault.currentBacking());
        console2.log("offering.stablecoinRaised", offering.stablecoinRaised());
        console2.log("revenue.totalHolderRevenue", revenue.totalHolderRevenue());
        console2.log("revenue.totalClaimed    ", revenue.totalClaimed());
        console2.log("redemption.totalRedeemedTokens", redemption.totalRedeemedTokens());
        console2.log("floor.floorPrice        ", floor.floorPrice());
        console2.log("market.lastRebalanceAt  ", market.lastRebalanceAt());
        console2.log("Tx hashes: broadcast/DemoFlow.s.sol/31337/run-latest.json (run with --slow)");
    }
}
