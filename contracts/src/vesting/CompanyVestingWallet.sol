// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { VestingWallet } from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @notice Linear vesting wallet for an issuer's disclosed company token allocation.
/// @dev The revenue distributor must register this address as yield-excluded before tokens arrive.
contract CompanyVestingWallet is VestingWallet {
    constructor(address beneficiary, uint64 startsAt, uint64 duration)
        VestingWallet(beneficiary, startsAt, duration)
    { }
}
