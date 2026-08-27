// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Conversion helpers for 18-decimal asset tokens and 6-decimal mUSD values.
library DecimalMath {
    uint256 internal constant ASSET_UNIT = 1e18;
    uint256 internal constant STABLE_UNIT = 1e6;
    uint256 internal constant BPS = 10_000;

    error ZeroPrice();

    /// @param assetAmount Asset-token amount in 18-decimal base units.
    /// @param stablePricePerToken mUSD base units paid for one whole asset token.
    function assetToStable(uint256 assetAmount, uint256 stablePricePerToken)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(assetAmount, stablePricePerToken, ASSET_UNIT);
    }

    /// @dev Rounds down so issuance never exceeds the stablecoin paid in.
    function stableToAsset(uint256 stableAmount, uint256 stablePricePerToken)
        internal
        pure
        returns (uint256)
    {
        if (stablePricePerToken == 0) revert ZeroPrice();
        return Math.mulDiv(stableAmount, ASSET_UNIT, stablePricePerToken);
    }

    function applyBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, BPS);
    }

    function deviationBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == b) return 0;
        if (b == 0) return type(uint256).max;
        return Math.mulDiv(a > b ? a - b : b - a, BPS, b);
    }
}

