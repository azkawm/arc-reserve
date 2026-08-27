// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only token that attempts one callback during transferFrom.
contract MockReentrantUSD is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public armed;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant Mock USD", "rmUSD") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        armed = true;
        reentrySucceeded = false;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (armed) {
            armed = false;
            (reentrySucceeded,) = callbackTarget.call(callbackData);
        }
        return super.transferFrom(from, to, value);
    }
}

