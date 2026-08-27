// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IUniswapV3Pool,
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback
} from "../interfaces/IUniswapV3Pool.sol";
import { TickPriceMath } from "../libraries/TickPriceMath.sol";

/// @notice Test-only callback harness; it is not an AMM and must never be used in production.
contract MockUniswapV3Pool is IUniswapV3Pool {
    using SafeERC20 for IERC20;

    address public immutable token0;
    address public immutable token1;
    int24 public immutable tickSpacing;
    uint160 public sqrtPriceX96;
    int24 public spotTick;
    int24 public twapTick;
    bool public initialized;
    uint256 public mintAmount0PerLiquidity = 1;
    uint256 public mintAmount1PerLiquidity = 1;
    uint16 public swapOutputBps = 9_900;

    mapping(bytes32 => uint128) public liquidityOf;

    constructor(address token0_, address token1_, int24 tickSpacing_) {
        token0 = token0_;
        token1 = token1_;
        tickSpacing = tickSpacing_;
    }

    function initialize(uint160 sqrtPriceX96_) external {
        require(!initialized, "INITIALIZED");
        sqrtPriceX96 = sqrtPriceX96_;
        initialized = true;
    }

    function setOracleForTest(int24 spotTick_, int24 twapTick_) external {
        spotTick = spotTick_;
        twapTick = twapTick_;
        sqrtPriceX96 = TickPriceMath.getSqrtRatioAtTick(spotTick_);
    }

    function setMintAmountsForTest(uint256 amount0PerLiquidity, uint256 amount1PerLiquidity)
        external
    {
        mintAmount0PerLiquidity = amount0PerLiquidity;
        mintAmount1PerLiquidity = amount1PerLiquidity;
    }

    function setSwapOutputBpsForTest(uint16 outputBps) external {
        swapOutputBps = outputBps;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, spotTick, 0, 2, 2, 0, true);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidity)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidity = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; ++i) {
            tickCumulatives[i] = -int56(twapTick) * int56(uint56(secondsAgos[i]));
        }
    }

    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        bytes calldata data
    ) external returns (uint256 amount0, uint256 amount1) {
        amount0 = uint256(liquidity) * mintAmount0PerLiquidity;
        amount1 = uint256(liquidity) * mintAmount1PerLiquidity;
        IUniswapV3MintCallback(msg.sender).uniswapV3MintCallback(amount0, amount1, data);
        liquidityOf[keccak256(abi.encode(recipient, tickLower, tickUpper))] += liquidity;
    }

    function burn(int24 tickLower, int24 tickUpper, uint128 liquidity)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        bytes32 key = keccak256(abi.encode(msg.sender, tickLower, tickUpper));
        require(liquidityOf[key] >= liquidity, "LIQUIDITY");
        liquidityOf[key] -= liquidity;
        amount0 = uint256(liquidity) * mintAmount0PerLiquidity;
        amount1 = uint256(liquidity) * mintAmount1PerLiquidity;
    }

    function collect(
        address recipient,
        int24,
        int24,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1) {
        amount0 = uint128(_min(amount0Requested, IERC20(token0).balanceOf(address(this))));
        amount1 = uint128(_min(amount1Requested, IERC20(token1).balanceOf(address(this))));
        if (amount0 != 0) IERC20(token0).safeTransfer(recipient, amount0);
        if (amount1 != 0) IERC20(token1).safeTransfer(recipient, amount1);
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        require(amountSpecified > 0, "EXACT_INPUT_ONLY");
        uint256 amountIn = uint256(amountSpecified);
        uint256 amountOut = amountIn * swapOutputBps / 10_000;
        if (zeroForOne) {
            amount0 = int256(amountIn);
            amount1 = -int256(amountOut);
            IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
            IERC20(token1).safeTransfer(recipient, amountOut);
        } else {
            amount0 = -int256(amountOut);
            amount1 = int256(amountIn);
            IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
            IERC20(token0).safeTransfer(recipient, amountOut);
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

