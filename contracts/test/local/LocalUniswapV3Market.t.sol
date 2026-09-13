// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockUSD } from "../../src/mocks/MockUSD.sol";
import { AssetRegistry } from "../../src/registry/AssetRegistry.sol";
import { IdentityRegistry } from "../../src/compliance/IdentityRegistry.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { PrimaryOffering } from "../../src/offering/PrimaryOffering.sol";
import { AssetMarketManager } from "../../src/market/AssetMarketManager.sol";
import { FloorController } from "../../src/market/FloorController.sol";
import { AssetFactory } from "../../src/factory/AssetFactory.sol";
import {
    TokenDeployer,
    VaultDeployer,
    OfferingDeployer,
    RevenueDeployer,
    RedemptionDeployer,
    MarketDeployer
} from "../../src/factory/ComponentDeployers.sol";
import { IUniswapV3Pool, IUniswapV3Factory } from "../../src/interfaces/IUniswapV3Pool.sol";
import { TickPriceMath } from "../../src/libraries/TickPriceMath.sol";

/// @dev Canonical-factory surface the production interface deliberately omits — ArcReserve only
///      needs `getPool`/`createPool`, but the fee-tier table is how a real factory proves itself.
interface IV3FactoryFeeTiers {
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
    function owner() external view returns (address);
}

/// @dev Minimal counterparty that pays whatever a real v3 pool asks for, so price can be moved
///      with a genuine trade rather than a test setter.
contract LocalSwapper {
    IUniswapV3Pool private immutable _pool;

    constructor(IUniswapV3Pool pool_) {
        _pool = pool_;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata)
        external
    {
        require(msg.sender == address(_pool), "POOL");
        if (amount0Delta > 0) IERC20(_pool.token0()).transfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) IERC20(_pool.token1()).transfer(msg.sender, uint256(amount1Delta));
    }

    function swap(bool zeroForOne, int256 amountSpecified, uint160 limit) external {
        _pool.swap(address(this), zeroForOne, amountSpecified, limit, "");
    }
}

/// @notice The engine against REAL Uniswap V3 — deployed locally, no fork and no RPC.
///
/// @dev    This is the third rung of a ladder, and it exists because the other two each miss
///         something:
///         - `MockUniswapV3Pool` is a callback harness. No curve, no tick crossing, no fee growth,
///           and `mint` charges `liquidity x 1` on both sides regardless of range. It cannot show
///           range/token asymmetry and it can never produce the inventory conversion that CREATES
///           flywheel surplus, so on the mock the flywheel correctly reports
///           `FlywheelSkipped("NO_SURPLUS")` forever.
///         - `test/fork/BaseSepoliaMarket.t.sol` fixes that, but needs `BASE_SEPOLIA_RPC_URL`, is
///           pinned to one block, and after the first run is served from Foundry's RPC cache — so
///           it re-verifies the contracts rather than the network, and it cannot run in CI or on a
///           plane.
///
///         Here the canonical `UniswapV3Factory` is DEPLOYED from vendored mainnet bytecode
///         (`vendor/UniswapV3Factory.json`, from the v3-core 1.0.1 npm package; its pool
///         init code hash is the mainnet constant `0xe34f199b…`). Same AMM, same tick math, same
///         fee accounting — and it runs in the default `forge test` with no network at all.
///
///         WHY ARCRESERVE CAN DO THIS AT ALL, when most V3 integrations cannot: the usual blocker
///         is `PoolAddress.POOL_INIT_CODE_HASH`, which periphery hardcodes and which breaks the
///         moment core is recompiled. ArcReserve never uses periphery — `AssetFactory` asks
///         `factory.getPool()` / `createPool()`, and the manager talks to the pool directly through
///         mint/burn/collect/swap callbacks. So no init-code-hash constant is in the path and any
///         faithful v3-core build works.
///
///         WHAT THIS STILL DOES NOT PROVE, same as the fork: not EIP-7825's per-transaction gas
///         cap, not Hedera's, not MEV or adversarial ordering, and not real-world liquidity depth.
contract LocalUniswapV3MarketTest is Test {
    uint24 private constant POOL_FEE = 3_000;
    uint256 private constant Q96 = 1 << 96;

    uint160 private constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant MAX_SQRT_RATIO =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    uint16 private constant COUNTRY_INDONESIA = 360;
    uint8 private constant CLASS_INSTITUTIONAL = 3;

    uint128 private constant POSITION_LIQUIDITY = 1e16;

    address private v3Factory;
    MockUSD private musd;
    AssetRegistry private registry;
    IdentityRegistry private identityRegistry;
    AssetFactory private factory;

    AssetToken private token;
    AssetVault private vault;
    PrimaryOffering private offering;
    AssetMarketManager private market;
    IUniswapV3Pool private pool;
    LocalSwapper private swapper;
    FloorController private floor;

    bytes32 private assetId;
    bool private assetIsToken0;
    address private buyer = makeAddr("buyer");

    function setUp() public {
        v3Factory = deployCode("vendor/UniswapV3Factory.json");
        _deployCore();
        _deploySystem();
        _configurePositions();
        _seedMarket();
        swapper = new LocalSwapper(pool);
        // The swapper RECEIVES SOLAR01 when it buys, and the token is permissioned on both legs,
        // so an unregistered counterparty reverts `RecipientNotVerified()`. Registering it is the
        // honest fixture: on a real chain any trader hitting the pool directly must be verified
        // too — the pool and manager are exempt infrastructure, arbitrary counterparties are not.
        identityRegistry.registerIdentity(
            address(swapper), address(swapper), COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0
        );
    }

    // -----------------------------------------------------------------
    // Fixture
    // -----------------------------------------------------------------

    function _deployCore() private {
        musd = new MockUSD();
        registry = new AssetRegistry(address(this));
        identityRegistry = new IdentityRegistry(address(this));
        AssetFactory.ComponentDeployerSet memory deployers = AssetFactory.ComponentDeployerSet({
            token: address(new TokenDeployer()),
            vault: address(new VaultDeployer()),
            offering: address(new OfferingDeployer()),
            revenue: address(new RevenueDeployer()),
            redemption: address(new RedemptionDeployer()),
            market: address(new MarketDeployer())
        });
        factory = new AssetFactory(address(registry), address(musd), address(this), deployers);
        registry.grantRole(registry.FACTORY_ROLE(), address(factory));
        factory.setApprovedPoolFactory(v3Factory, true);

        identityRegistry.registerIdentity(
            address(this), address(this), COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0
        );
        identityRegistry.registerIdentity(buyer, buyer, COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0);

        assetIsToken0 = vm.computeCreateAddress(deployers.token, 1) < address(musd);
    }

    function _deploySystem() private {
        uint64 maturity = uint64(block.timestamp + 3 * 365 days);
        assetId = registry.submitAsset(
            "Solar Indonesia 01", "Renewable energy", "ipfs://local", keccak256("local"), maturity
        );
        AssetFactory.DeploymentParams memory params = AssetFactory.DeploymentParams({
            assetId: assetId,
            tokenName: "Solar Indonesia 01",
            tokenSymbol: "SOLAR01",
            maximumSupply: 100_000e18,
            minimumReserveRatioBps: 2_000,
            offeringStartsAt: uint64(block.timestamp),
            offeringEndsAt: uint64(block.timestamp + 30 days),
            tokenPrice: 1e6,
            fundraisingCap: 80_000e6,
            walletPurchaseLimit: 80_000e6,
            offeringInventory: 80_000e18,
            minimumPurchase: 1e6,
            redemptionPeriodDuration: 1 days,
            redemptionPeriodLimitTokens: 25_000e18,
            operator: address(this),
            revenueDepositor: address(this),
            poolFactory: v3Factory,
            poolFee: POOL_FEE,
            initialSqrtPriceX96: assetIsToken0 ? uint160(Q96 / 1e6) : uint160(Q96 * 1e6),
            identityRegistry: address(identityRegistry)
        });
        registry.approveAsset(assetId, 1e6, keccak256(abi.encode(params)));

        factory.beginAssetSystem(params);
        AssetFactory.Deployment memory d = factory.completeAssetSystem(assetId, params);

        token = AssetToken(d.token);
        vault = AssetVault(d.vault);
        offering = PrimaryOffering(d.offering);
        market = AssetMarketManager(d.marketManager);
        pool = IUniswapV3Pool(d.pool);
        assertEq(market.assetIsToken0(), assetIsToken0, "ordering prediction failed");
    }

    function _configurePositions() private {
        if (assetIsToken0) {
            market.configureCorePositions(-278_400, -276_600, -276_600, -276_000);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, -276_000, -274_800
            );
        } else {
            market.configureCorePositions(276_600, 278_400, 276_000, 276_600);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, 274_800, 276_000
            );
        }
    }

    function _seedMarket() private {
        musd.faucet(buyer, 80_000e6);
        vm.startPrank(buyer);
        musd.approve(address(offering), 80_000e6);
        offering.buy(80_000e6, 0);
        token.approve(address(market), 20_000e18);
        market.fundTokenInventory(20_000e18);
        vm.stopPrank();

        market.fundFromVault(vault.marketMakingAllocation());
    }

    function _add(AssetMarketManager.PositionKind kind)
        private
        returns (uint256 assetAmount, uint256 stableAmount)
    {
        (uint256 amount0, uint256 amount1) = market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: kind,
                liquidity: POSITION_LIQUIDITY,
                maxAmount0: type(uint128).max,
                maxAmount1: type(uint128).max,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
        return assetIsToken0 ? (amount0, amount1) : (amount1, amount0);
    }

    function _spotTick() private view returns (int24 tick) {
        (, tick,,,,,) = pool.slot0();
    }

    function _installFloor() private {
        floor = new FloorController(
            address(vault),
            address(registry),
            assetId,
            assetIsToken0,
            market.tickSpacing(),
            assetIsToken0 ? int24(-288_420) : int24(288_420),
            0,
            address(this)
        );
        market.setFloorController(address(floor));
    }

    /// @dev Pushes the ASSET price up until the pool reaches `targetTick`, using the price limit
    ///      rather than an amount. Sizing by amount alone is hopeless on a thin pool — an oversized
    ///      order consumes every position and pins the price at a tick extreme.
    function _pushAssetPriceUpTo(int24 targetTick) private {
        // Asset price up = higher tick when the asset is token0, lower tick when it is token1.
        bool zeroForOne = !assetIsToken0;
        musd.faucet(address(swapper), 200_000e6);
        vm.prank(buyer);
        token.transfer(address(swapper), 5_000e18);
        swapper.swap(zeroForOne, int256(100_000e6), TickPriceMath.getSqrtRatioAtTick(targetTick));
    }

    function _tradeThroughManager(string memory label, uint256 amountIn)
        private
        returns (address trader)
    {
        trader = makeAddr(label);
        identityRegistry.registerIdentity(trader, trader, COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0);
        musd.faucet(trader, amountIn);
        vm.startPrank(trader);
        musd.approve(address(market), amountIn);
        market.swapExactInput(address(musd), amountIn, 0, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function _spentFromSwapLog(Vm.Log[] memory logs) private view returns (uint256 spent) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(market)) continue;
            if (logs[i].topics[0] != AssetMarketManager.SwapExactInput.selector) continue;
            (, spent,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            return spent;
        }
        revert("no SwapExactInput event found");
    }

    // -----------------------------------------------------------------
    // It really is canonical Uniswap, deployed locally
    // -----------------------------------------------------------------

    /// @dev The claim the whole file rests on. A mock that merely implements the interface would
    ///      pass every other test here while proving nothing, so identity is asserted first and
    ///      by size: the real pool is ~22KB of bytecode, `MockUniswapV3Pool` is a fraction of that.
    function test_poolIsRealLocallyDeployedUniswapV3() public view {
        assertEq(
            IUniswapV3Factory(v3Factory).getPool(address(token), address(musd), POOL_FEE),
            address(pool),
            "factory does not know this pool"
        );
        assertGt(v3Factory.code.length, 20_000, "factory is not canonical-sized");
        assertGt(address(pool).code.length, 20_000, "mock-sized pool bytecode");
        assertEq(pool.tickSpacing(), 60, "fee tier 3000 must map to spacing 60");
        // The factory's own constructor registered the fee tiers; spacing 60 for 3000 is the
        // canonical mapping and is what proves this is a real factory rather than a stand-in.
        assertEq(IV3FactoryFeeTiers(v3Factory).feeAmountTickSpacing(POOL_FEE), int24(60));
        assertEq(IV3FactoryFeeTiers(v3Factory).feeAmountTickSpacing(500), int24(10));
        assertEq(IV3FactoryFeeTiers(v3Factory).feeAmountTickSpacing(10_000), int24(200));

        int24 expected = assetIsToken0 ? int24(-276_325) : int24(276_324);
        assertApproxEqAbs(int256(_spotTick()), int256(expected), 2, "not initialized at ~1 mUSD");
    }

    // -----------------------------------------------------------------
    // Range/token asymmetry — impossible to show on the mock
    // -----------------------------------------------------------------

    function test_reserveFloorConsumesStableOnly() public {
        (uint256 assetAmount, uint256 stableAmount) =
            _add(AssetMarketManager.PositionKind.ReserveFloor);
        console2.log("reserveFloor asset :", assetAmount);
        console2.log("reserveFloor stable:", stableAmount);
        assertEq(assetAmount, 0, "a below-spot range must need no asset tokens");
        assertGt(stableAmount, 0);
    }

    function test_discoveryConsumesAssetOnly() public {
        (uint256 assetAmount, uint256 stableAmount) =
            _add(AssetMarketManager.PositionKind.Discovery);
        console2.log("discovery asset :", assetAmount);
        console2.log("discovery stable:", stableAmount);
        assertGt(assetAmount, 0, "an above-spot range must need asset tokens");
        assertEq(stableAmount, 0);
    }

    function test_anchorStraddlesSpotAndConsumesBoth() public {
        (uint256 assetAmount, uint256 stableAmount) = _add(AssetMarketManager.PositionKind.Anchor);
        console2.log("anchor asset :", assetAmount);
        console2.log("anchor stable:", stableAmount);
        assertGt(assetAmount, 0, "a straddling range needs both sides");
        assertGt(stableAmount, 0);
    }

    // -----------------------------------------------------------------
    // A genuine trade drives the D-036 signal
    // -----------------------------------------------------------------

    function test_aRealSwapMovesPriceOutOfTheBandAndEnablesSlide() public {
        _add(AssetMarketManager.PositionKind.Anchor);
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        int24 tickBefore = _spotTick();
        assertTrue(tickBefore > anchorLower && tickBefore < anchorUpper, "should start in-band");

        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 60, anchorUpper + 60);

        _pushAssetPriceUpTo(assetIsToken0 ? anchorUpper + 120 : anchorLower - 120);

        int24 tickAfter = _spotTick();
        console2.log("tick before / after swap:");
        console2.logInt(tickBefore);
        console2.logInt(tickAfter);
        bool leftUpside = assetIsToken0 ? tickAfter > anchorUpper : tickAfter < anchorLower;
        assertTrue(leftUpside, "swap did not push price out of the anchor band");

        // D-015: empty the position, then move it.
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor,
            POSITION_LIQUIDITY,
            0,
            0,
            block.timestamp + 1 hours
        );
        market.slide(anchorLower + 60, anchorUpper + 60);
        (int24 newLower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLower, anchorLower + 60, "slide did not move the anchor");
    }

    // -----------------------------------------------------------------
    // Fees accrue and collect against a real curve
    // -----------------------------------------------------------------

    function test_collectFeesAfterRealSwaps() public {
        _add(AssetMarketManager.PositionKind.Anchor);
        _pushAssetPriceUpTo(assetIsToken0 ? _spotTick() + 120 : _spotTick() - 120);

        (uint256 amount0, uint256 amount1) =
            market.collectFees(AssetMarketManager.PositionKind.Anchor);
        console2.log("collectFees on a LIVE position -> amount0, amount1:");
        console2.log(amount0);
        console2.log(amount1);
        assertGt(amount0 + amount1, 0, "real swaps must accrue collectable fees");
    }

    // -----------------------------------------------------------------
    // The flywheel — the thing the mock structurally cannot demonstrate
    // -----------------------------------------------------------------

    /// @notice The product thesis, mechanically, now provable with no network: a trade buys SOLAR01
    ///         out of the discovery range, the pool converts that inventory to mUSD, harvesting
    ///         realises it, the surplus crosses into the protected reserve, backing rises, and the
    ///         published floor ratchets.
    function test_theFlywheelTurnsLocally() public {
        _installFloor();
        (uint256 assetIn, uint256 stableIn) = _add(AssetMarketManager.PositionKind.Discovery);
        assertGt(assetIn, 0, "discovery should hold asset inventory");
        assertEq(stableIn, 0);

        uint256 reserveBefore = vault.redemptionReserve();
        uint256 backingBefore = vault.currentBacking();
        int24 floorBefore = floor.floorTick();

        vm.recordLogs();
        _tradeThroughManager("flywheelTrader", 60_000e6);
        uint256 spent = _spentFromSwapLog(vm.getRecordedLogs());

        (,, uint128 discoveryAfter,) = market.positions(AssetMarketManager.PositionKind.Discovery);
        assertEq(discoveryAfter, 0, "discovery was not harvested");

        uint256 reserveAfter = vault.redemptionReserve();
        console2.log("reserve before / after:");
        console2.log(reserveBefore);
        console2.log(reserveAfter);
        console2.log("backing before / after:");
        console2.log(backingBefore);
        console2.log(vault.currentBacking());

        assertGt(reserveAfter, reserveBefore, "surplus never reached the protected reserve");
        assertGt(vault.currentBacking(), backingBefore, "backing did not rise");

        // The money the trader spent IS the money that became backing. Not exact: Uniswap rounds
        // position accounting down, so the reserve gains a couple of base units less than was
        // spent. That direction is the safe one.
        assertApproxEqAbs(
            reserveAfter - reserveBefore,
            spent,
            10,
            "reserve delta should reconcile with what the trader actually spent"
        );
        assertTrue(
            assetIsToken0 ? floor.floorTick() > floorBefore : floor.floorTick() < floorBefore,
            "the floor did not ratchet"
        );
    }

    /// @dev The refund guard: a swap that exhausts liquidity stops early, and the unspent input
    ///      must go back to the trader rather than sit in the manager being miscounted as surplus.
    function test_swapExactInputRefundsInputItCouldNotSpend() public {
        _add(AssetMarketManager.PositionKind.Discovery);

        vm.recordLogs();
        address trader = _tradeThroughManager("refundTrader", 60_000e6);
        uint256 spent = _spentFromSwapLog(vm.getRecordedLogs());

        assertLt(spent, 60_000e6, "the thin pool cannot have absorbed the whole order");
        assertGt(musd.balanceOf(trader), 50_000e6, "unspent input was not refunded");
        assertEq(
            market.creditableSurplus(), 0, "unspent trader input is being counted as market surplus"
        );
    }

    // -----------------------------------------------------------------
    // D-039 against a real AMM
    // -----------------------------------------------------------------

    /// @dev The NAV-independence claim, re-proven where the liquidity math is real rather than a
    ///      harness. If a NAV dependency survived anywhere in the capital path, a real mint is
    ///      where it would show.
    function test_theEngineRunsAgainstRealUniswapWithAStaleNav() public {
        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId), "precondition: NAV must actually be stale");

        (AssetMarketManager.SafetyFailure failure,,,) = market.safetyState(true);
        assertEq(uint8(failure), uint8(AssetMarketManager.SafetyFailure.None));

        (uint256 assetAmount, uint256 stableAmount) = _add(AssetMarketManager.PositionKind.Anchor);
        assertGt(assetAmount + stableAmount, 0, "capital must deploy with a stale NAV");
        (,, uint128 liquidity,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(liquidity, POSITION_LIQUIDITY);
    }
}
