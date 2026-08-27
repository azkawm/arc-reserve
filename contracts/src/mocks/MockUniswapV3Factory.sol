// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MockUniswapV3Pool } from "./MockUniswapV3Pool.sol";
import { IUniswapV3Factory } from "../interfaces/IUniswapV3Pool.sol";

/// @notice Test-only pool factory for local Anvil demonstrations.
contract MockUniswapV3Factory is IUniswapV3Factory {
    mapping(bytes32 => address) private _pools;

    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        returns (address pool)
    {
        require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "TOKENS");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 key = keccak256(abi.encode(token0, token1, fee));
        require(_pools[key] == address(0), "EXISTS");
        int24 spacing = fee == 500 ? int24(10) : fee == 3_000 ? int24(60) : int24(200);
        pool = address(new MockUniswapV3Pool(token0, token1, spacing));
        _pools[key] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return _pools[keccak256(abi.encode(token0, token1, fee))];
    }
}
