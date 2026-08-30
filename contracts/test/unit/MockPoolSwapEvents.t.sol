// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockUSD } from "../../src/mocks/MockUSD.sol";
import { MockUniswapV3Pool } from "../../src/mocks/MockUniswapV3Pool.sol";
import { IUniswapV3Pool } from "../../src/interfaces/IUniswapV3Pool.sol";
import { TickPriceMath } from "../../src/libraries/TickPriceMath.sol";

/// @dev Minimal counterparty: pays whatever the pool asks for in the swap callback.
contract SwapHarness {
    MockUniswapV3Pool public pool;

    constructor(MockUniswapV3Pool pool_) {
        pool = pool_;
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata)
        external
    {
        if (amount0Delta > 0) {
            IERC20(pool.token0()).transfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            IERC20(pool.token1()).transfer(msg.sender, uint256(amount1Delta));
        }
    }

    function swap(bool zeroForOne, int256 amountSpecified) external {
        pool.swap(address(this), zeroForOne, amountSpecified, 0, "");
    }
}

/// @notice Task 10: the demo pool emits canonical `Initialize` and `Swap` so the indexer's
///         canonical ingestion path is exercised on Anvil rather than first meeting reality on a
///         public testnet. Magnitude is a labelled stand-in; direction and encoding are canonical.
contract MockPoolSwapEventsTest is Test {
    MockUSD internal tokenA;
    MockUSD internal tokenB;
    MockUniswapV3Pool internal pool;
    SwapHarness internal harness;

    int24 internal constant SPACING = 60;
    int24 internal constant START_TICK = 0;

    function setUp() public {
        tokenA = new MockUSD();
        tokenB = new MockUSD();
        pool = new MockUniswapV3Pool(address(tokenA), address(tokenB), SPACING);
        harness = new SwapHarness(pool);
        tokenA.faucet(address(harness), 1_000_000e6);
        tokenB.faucet(address(harness), 1_000_000e6);
        tokenA.faucet(address(pool), 1_000_000e6);
        tokenB.faucet(address(pool), 1_000_000e6);
    }

    // -----------------------------------------------------------------
    // Initialize
    // -----------------------------------------------------------------

    function test_initializeEmitsCanonically() public {
        uint160 sqrtPrice = TickPriceMath.getSqrtRatioAtTick(START_TICK);
        vm.expectEmit(false, false, false, true, address(pool));
        emit IUniswapV3Pool.Initialize(sqrtPrice, START_TICK);
        pool.initialize(sqrtPrice);
    }

    // -----------------------------------------------------------------
    // Swap
    // -----------------------------------------------------------------

    function test_swapEmitsCanonicalTopicAndArgs() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));

        vm.recordLogs();
        harness.swap(true, 1_000e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(pool)) continue;
            if (
                logs[i].topics[0]
                    != keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
            ) {
                continue;
            }
            found = true;
            // The canonical topic0 the backend asserts against.
            assertEq(
                logs[i].topics[0],
                bytes32(0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67)
            );
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(harness)); // sender
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(harness)); // recipient

            (int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick) =
                abi.decode(logs[i].data, (int256, int256, uint160, uint128, int24));
            assertEq(amount0, int256(1_000e6));
            assertLt(amount1, 0); // tokens left the pool
            assertEq(sqrtPriceX96, pool.sqrtPriceX96());
            assertEq(liquidity, pool.totalLiquidity());
            assertEq(tick, pool.spotTick());
        }
        assertTrue(found, "no canonical Swap emitted");
    }

    // -----------------------------------------------------------------
    // Direction is canonical even though magnitude is a stand-in
    // -----------------------------------------------------------------

    function test_sellingToken0LowersThePrice() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        harness.swap(true, 1_000e6);
        assertEq(pool.spotTick(), START_TICK - SPACING);
        assertEq(pool.sqrtPriceX96(), TickPriceMath.getSqrtRatioAtTick(START_TICK - SPACING));
    }

    function test_sellingToken1RaisesThePrice() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        harness.swap(false, 1_000e6);
        assertEq(pool.spotTick(), START_TICK + SPACING);
    }

    function test_impactScalesWithSize() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        harness.swap(false, 100e6); // a tenth of the unit moves a tenth of a spacing
        assertEq(pool.spotTick(), START_TICK + 6);
    }

    function test_impactIsCapped() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        harness.swap(false, 500_000e6); // would be 30,000 ticks uncapped
        assertEq(pool.spotTick(), START_TICK + pool.maxTickMovePerSwap());
    }

    function test_priceCanBePinnedForDeterministicTests() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        pool.setSwapImpactForTest(0, 600);
        harness.swap(true, 10_000e6);
        assertEq(pool.spotTick(), START_TICK); // unmoved
    }

    function test_repeatedSwapsWalkThePriceAndProduceCandleInput() public {
        pool.initialize(TickPriceMath.getSqrtRatioAtTick(START_TICK));
        for (uint256 i = 0; i < 5; i++) {
            harness.swap(false, 1_000e6);
        }
        assertEq(pool.spotTick(), START_TICK + 5 * SPACING);
    }
}
