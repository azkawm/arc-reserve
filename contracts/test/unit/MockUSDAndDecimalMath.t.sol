// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MockUSD } from "../../src/mocks/MockUSD.sol";
import { DecimalMath } from "../../src/libraries/DecimalMath.sol";

contract DecimalHarness {
    function assetToStable(uint256 amount, uint256 price) external pure returns (uint256) {
        return DecimalMath.assetToStable(amount, price);
    }

    function stableToAsset(uint256 amount, uint256 price) external pure returns (uint256) {
        return DecimalMath.stableToAsset(amount, price);
    }
}

contract MockUSDAndDecimalMathTest is Test {
    MockUSD private musd;
    DecimalHarness private decimal;

    function setUp() public {
        musd = new MockUSD();
        decimal = new DecimalHarness();
    }

    function testFaucetAndSixDecimals() public {
        musd.faucet();
        assertEq(musd.decimals(), 6);
        assertEq(musd.balanceOf(address(this)), 100_000e6);
    }

    function testExactSixToEighteenDecimalConversions() public view {
        assertEq(decimal.stableToAsset(1e6, 1e6), 1e18);
        assertEq(decimal.assetToStable(1e18, 1e6), 1e6);
        assertEq(decimal.stableToAsset(12_345_678, 1_250_000), 9_876_542_400_000_000_000);
    }

    function testConversionRoundsDownWithoutCreatingValue() public view {
        uint256 tokens = decimal.stableToAsset(1, 3e6);
        assertEq(tokens, 333_333_333_333);
        assertLe(decimal.assetToStable(tokens, 3e6), 1);
    }

    function testFuzzConversionNeverReturnsMoreStable(uint96 stable, uint64 price) public view {
        uint256 safePrice = bound(uint256(price), 1, 1_000_000e6);
        uint256 tokens = decimal.stableToAsset(stable, safePrice);
        assertLe(decimal.assetToStable(tokens, safePrice), stable);
    }
}

