// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
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

/// @dev Minimal counterparty that pays whatever a real v3 pool asks for. Used to move the price
///      with a genuine trade rather than a test setter.
contract ForkSwapper {
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

/// @notice Fork tests against the CANONICAL Uniswap V3 on Base Sepolia.
///
/// @dev    Everything else in the suite runs against `MockUniswapV3Pool`, which is a callback
///         harness: no curve, no tick crossing, no fee growth, and mint amounts of
///         `liquidity x 1` on both sides regardless of range. That hides exactly the properties the
///         engine depends on. These tests exist to cover what the mock structurally cannot.
///
///         Excluded from the default run (see `no_match_path` in foundry.toml). Run with:
///           FOUNDRY_PROFILE=fork forge test -vv
///         Requires `BASE_SEPOLIA_RPC_URL`.
///
///         The block is PINNED. Unpinned, every run re-fetches and results drift with chain state;
///         pinned, Foundry caches it and the suite is deterministic and cheap after the first run.
///
///         WHAT A FORK STILL DOES NOT PROVE: it does not enforce EIP-7825's per-transaction gas cap
///         (nor Hedera's). That is precisely how an 18.4M-gas `deployAssetSystem` passed every fork
///         rehearsal before being rejected at precheck on the real chain. Green here means the logic
///         and the liquidity math are right - never that it will broadcast.
contract BaseSepoliaMarketForkTest is Test {
    /// @dev Uniswap V3 factory on Base SEPOLIA. The same address is V2 Router02 on Base MAINNET -
    ///      chain-specific, never copied by pattern.
    address private constant V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    uint256 private constant FORK_BLOCK = 46_710_000;
    uint24 private constant POOL_FEE = 3_000;
    uint256 private constant Q96 = 1 << 96;

    uint160 private constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant MAX_SQRT_RATIO =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    uint16 private constant COUNTRY_INDONESIA = 360;
    uint8 private constant CLASS_INSTITUTIONAL = 3;

    uint128 private constant POSITION_LIQUIDITY = 1e16;

    MockUSD private musd;
    AssetRegistry private registry;
    IdentityRegistry private identityRegistry;
    AssetFactory private factory;

    AssetToken private token;
    AssetVault private vault;
    PrimaryOffering private offering;
    AssetMarketManager private market;
    IUniswapV3Pool private pool;
    ForkSwapper private swapper;
    FloorController private floor;

    bytes32 private assetId;
    bool private assetIsToken0;
    address private buyer = makeAddr("buyer");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("base_sepolia"), FORK_BLOCK);
        _deployCore();
        _deploySystem();
        _configurePositions();
        _seedMarket();
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
        factory.setApprovedPoolFactory(V3_FACTORY, true);

        identityRegistry.registerIdentity(
            address(this), address(this), COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0
        );
        identityRegistry.registerIdentity(buyer, buyer, COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0);

        // The asset token is the TokenDeployer's first CREATE, so its address - and therefore the
        // pool's token ordering - is known before it exists.
        assetIsToken0 = vm.computeCreateAddress(deployers.token, 1) < address(musd);
    }

    function _deploySystem() private {
        uint64 maturity = uint64(block.timestamp + 3 * 365 days);
        assetId = registry.submitAsset(
            "Solar Indonesia 01", "Renewable energy", "ipfs://fork", keccak256("fork"), maturity
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
            poolFactory: V3_FACTORY,
            poolFee: POOL_FEE,
            // One mUSD per whole token, exact for either ordering.
            initialSqrtPriceX96: assetIsToken0 ? uint160(Q96 / 1e6) : uint160(Q96 * 1e6),
            identityRegistry: address(identityRegistry)
        });
        registry.approveAsset(assetId, 1e6, keccak256(abi.encode(params)));

        // D-033 two-phase deployment, against real Uniswap.
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
            0, // no cooldown, so the ratchet is observable within one test
            address(this)
        );
        market.setFloorController(address(floor));
    }

    /// @dev Buys SOLAR01 with mUSD through the manager's own entry point. Which pool direction
    ///      that is depends on the ordering, but `swapExactInput` works it out from `tokenIn`.
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

    // -----------------------------------------------------------------
    // D-035: the flywheel
    // -----------------------------------------------------------------

    /// @notice The product thesis, mechanically: a trade buys SOLAR01 out of the discovery range,
    ///         the pool converts that inventory to mUSD, harvesting realises it, the surplus
    ///         crosses into the protected reserve, backing rises, and the published floor ratchets.
    ///         Before this existed, trading did nothing to backing at all.
    function test_theFlywheelTurns() public {
        _installFloor();
        (uint256 assetIn, uint256 stableIn) = _add(AssetMarketManager.PositionKind.Discovery);
        assertGt(assetIn, 0, "discovery should hold asset inventory");
        assertEq(stableIn, 0);

        uint256 reserveBefore = vault.redemptionReserve();
        uint256 backingBefore = vault.currentBacking();
        int24 floorBefore = floor.floorTick();

        _tradeThroughManager("flywheelTrader", 60_000e6);

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
        // Price-up is a higher tick when the asset is token0 and a lower one when it is token1.
        assertTrue(
            assetIsToken0 ? floor.floorTick() > floorBefore : floor.floorTick() < floorBefore,
            "the floor did not ratchet"
        );
    }

    /// @dev The trap this guards: a swap that exhausts liquidity stops early and leaves input
    ///      unspent in the manager. Left there it would be counted as market surplus on the next
    ///      credit — quietly converting a trader's own money into protected reserve.
    function test_swapExactInputRefundsInputItCouldNotSpend() public {
        _add(AssetMarketManager.PositionKind.Discovery);
        // Discovery holds only a few hundred mUSD of capacity, so most of this order is unspendable.
        address trader = _tradeThroughManager("refundTrader", 60_000e6);

        assertGt(musd.balanceOf(trader), 50_000e6, "unspent input was not refunded");
        assertEq(
            market.creditableSurplus(), 0, "unspent trader input is being counted as market surplus"
        );
    }

    // -----------------------------------------------------------------
    // The pool really is canonical
    // -----------------------------------------------------------------

    function test_poolIsARealUniswapV3Pool() public view {
        assertEq(
            IUniswapV3Factory(V3_FACTORY).getPool(address(token), address(musd), POOL_FEE),
            address(pool),
            "factory does not know this pool"
        );
        assertGt(address(pool).code.length, 20_000, "mock-sized bytecode");
        assertEq(pool.tickSpacing(), 60);
        // Initialized at one mUSD for whichever ordering we got.
        int24 expected = assetIsToken0 ? int24(-276_325) : int24(276_324);
        assertApproxEqAbs(int256(_spotTick()), int256(expected), 2, "not initialized at ~1 mUSD");
    }

    // -----------------------------------------------------------------
    // Range/token asymmetry - the headline thing the mock cannot show
    // -----------------------------------------------------------------

    /// @dev A range entirely on the cheap side of spot is funded with STABLE only. The mock charges
    ///      `liquidity x 1` of both tokens regardless, so this property has never been exercised -
    ///      and it is the basis of the claim that the reserve floor is the cheapest first position
    ///      to fund when no asset tokens exist yet.
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
        assertGt(assetAmount, 0);
        assertEq(stableAmount, 0, "an above-spot range must need no stable");
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

    /// @dev Everywhere else the price is moved with `setOracleForTest`, a mock-only setter. Here a
    ///      real swap against real liquidity moves the tick, which is the only way to show that the
    ///      anchor-range signal fires from actual trading rather than from a test hook.
    function test_aRealSwapMovesPriceOutOfTheBandAndEnablesSlide() public {
        _add(AssetMarketManager.PositionKind.ReserveFloor);
        _add(AssetMarketManager.PositionKind.Anchor);
        _add(AssetMarketManager.PositionKind.Discovery);

        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        int24 tickBefore = _spotTick();
        assertTrue(tickBefore > anchorLower && tickBefore < anchorUpper, "should start in-band");

        // Slide must be refused while price is inside the band.
        vm.expectRevert(AssetMarketManager.InvalidRange.selector);
        market.slide(anchorLower + 60, anchorUpper + 60);

        // Stop the swap two spacings past the band. Sizing by amount alone is hopeless on a thin
        // pool - a 40,000 mUSD order consumed every position and pinned the price at MIN_TICK,
        // which then tripped the spot/NAV guard. The sqrtPriceLimit is the right instrument.
        _pushAssetPriceUpTo(assetIsToken0 ? anchorUpper + 120 : anchorLower - 120);

        int24 tickAfter = _spotTick();
        console2.log("tick before / after swap:");
        console2.logInt(tickBefore);
        console2.logInt(tickAfter);
        bool leftUpside = assetIsToken0 ? tickAfter > anchorUpper : tickAfter < anchorLower;
        assertTrue(leftUpside, "swap did not push price out of the anchor band");

        // D-015: empty the position, then move it.
        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, POSITION_LIQUIDITY, 0, 0, block.timestamp + 1
        );
        int24 shift = assetIsToken0 ? int24(60) : int24(-60);
        market.slide(anchorLower + shift, anchorUpper + shift);

        (int24 newLower,,,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(newLower, anchorLower + shift, "anchor did not follow the price");
    }

    /// @dev Buying the asset pushes its price up. Which pool direction that is depends on the
    ///      ordering: the asset is token0 here, token1 there. The swap is bounded by a
    ///      sqrtPriceLimit at `targetTick` rather than by size, so it stops exactly where we want
    ///      regardless of how thin the liquidity is.
    function _pushAssetPriceUpTo(int24 targetTick) private {
        swapper = new ForkSwapper(pool);
        identityRegistry.registerIdentity(
            address(swapper), address(swapper), COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0
        );
        musd.faucet(address(swapper), 60_000e6);

        bool zeroForOne = !assetIsToken0; // spend stable, receive asset
        swapper.swap(zeroForOne, int256(40_000e6), TickPriceMath.getSqrtRatioAtTick(targetTick));
    }

    /// @dev Unbounded version, for the fee test where the destination does not matter.
    function _pushAssetPriceUp() private {
        (int24 anchorLower, int24 anchorUpper,,) =
            market.positions(AssetMarketManager.PositionKind.Anchor);
        _pushAssetPriceUpTo(assetIsToken0 ? anchorUpper + 120 : anchorLower - 120);
    }

    // -----------------------------------------------------------------
    // Fees: only a real pool accrues them
    // -----------------------------------------------------------------

    /// @dev `collectFees` returns 0 on the mock because the mock has no fee growth, which means the
    ///      "does a position need a burn(0) poke before fees are collectable" question has never
    ///      been answerable. Here there are real fees to collect.
    function test_collectFeesAfterRealSwapsOnAStraddlingPosition() public {
        _add(AssetMarketManager.PositionKind.Anchor);
        _pushAssetPriceUp();

        // The regression: `collectFees` now pokes the live position first, so the fees the swap
        // generated are attributed and come out on the FIRST call. Before the fix this returned
        // 0/0 and a keeper would have concluded there was nothing to collect.
        (uint256 amount0, uint256 amount1) =
            market.collectFees(AssetMarketManager.PositionKind.Anchor);
        console2.log("collectFees on a LIVE position -> amount0, amount1:");
        console2.log(amount0);
        console2.log(amount1);
        assertGt(amount0 + amount1, 0, "fees accrued but collectFees returned nothing");
    }

    /// @dev The other half of the fix: the poke must be skipped when the position is empty. v3
    ///      reverts `NP` on a zero-liquidity burn against a position holding nothing, so an
    ///      unconditional poke would break collecting the fees a full removal left owed - which is
    ///      exactly when a keeper reaches for `collectFees`.
    function test_collectFeesStillWorksAfterThePositionIsFullyRemoved() public {
        _add(AssetMarketManager.PositionKind.Anchor);
        _pushAssetPriceUp();

        market.removeLiquidity(
            AssetMarketManager.PositionKind.Anchor, POSITION_LIQUIDITY, 0, 0, block.timestamp + 1
        );
        (,, uint128 remaining,) = market.positions(AssetMarketManager.PositionKind.Anchor);
        assertEq(remaining, 0, "position should be empty");

        // Must not revert, and must still hand back what the removal left owed.
        (uint256 amount0, uint256 amount1) =
            market.collectFees(AssetMarketManager.PositionKind.Anchor);
        console2.log("collectFees on an EMPTY position -> amount0, amount1:");
        console2.log(amount0);
        console2.log(amount1);
        assertGt(amount0 + amount1, 0, "fees left owed by the removal were not recoverable");
    }
}
