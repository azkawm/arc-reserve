// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IComplianceModule } from "../ICompliance.sol";

/// @title TransferLockModule
/// @notice Resale hold period: tokens received through primary issuance (a mint) cannot be
///         transferred by that holder until `holdPeriod` has elapsed. Redemption burns are never
///         blocked, so a locked holder can still exit through the protected reserve.
///         Secondary-market acquisitions are not locked. A hold period of 0 disables the rule.
contract TransferLockModule is AccessControl, IComplianceModule {
    bytes32 public constant MODULE_ADMIN_ROLE = keccak256("MODULE_ADMIN_ROLE");

    mapping(address => uint64) public holdPeriod;
    mapping(address => mapping(address => uint64)) private _lockedUntil;

    event HoldPeriodSet(address indexed compliance, uint64 holdPeriod);
    event HolderLocked(address indexed compliance, address indexed holder, uint64 lockedUntil);

    error InvalidAddress();

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MODULE_ADMIN_ROLE, admin);
    }

    function setHoldPeriod(address compliance, uint64 period) external onlyRole(MODULE_ADMIN_ROLE) {
        if (compliance == address(0)) revert InvalidAddress();
        holdPeriod[compliance] = period;
        emit HoldPeriodSet(compliance, period);
    }

    function lockedUntil(address compliance, address holder) external view returns (uint64) {
        return _lockedUntil[compliance][holder];
    }

    function moduleCheck(address from, address to, uint256, address) external view returns (bool) {
        if (from == address(0) || to == address(0)) return true;
        return _lockedUntil[msg.sender][from] <= block.timestamp;
    }

    function moduleTransferAction(address, address, uint256, address) external { }

    /// @dev Each primary issuance restarts the holder's hold period.
    function moduleMintAction(address to, uint256, address) external {
        uint64 period = holdPeriod[msg.sender];
        if (period == 0) return;
        uint64 until = uint64(block.timestamp) + period;
        _lockedUntil[msg.sender][to] = until;
        emit HolderLocked(msg.sender, to, until);
    }

    function moduleBurnAction(address, uint256, address) external { }

    function name() external pure returns (string memory) {
        return "TransferLockModule";
    }
}
