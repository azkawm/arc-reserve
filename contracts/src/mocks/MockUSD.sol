// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only six-decimal stablecoin. The faucet is deliberately unrestricted for local demos.
contract MockUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 100_000e6;

    event FaucetUsed(address indexed account, uint256 amount);

    constructor() ERC20("Mock USD", "mUSD") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetUsed(msg.sender, FAUCET_AMOUNT);
    }

    function faucet(address recipient, uint256 amount) external {
        _mint(recipient, amount);
        emit FaucetUsed(recipient, amount);
    }
}

