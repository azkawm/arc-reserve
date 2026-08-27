// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IIdentityRegistry } from "./IIdentityRegistry.sol";

/// @title ICompliance
/// @notice ERC-3643-shaped modular compliance bound to exactly one token.
interface ICompliance {
    event TokenBound(address indexed token);
    event TokenUnbound(address indexed token);
    event ModuleAdded(address indexed module);
    event ModuleRemoved(address indexed module);

    function bindToken(address token) external;
    function unbindToken(address token) external;
    function isTokenBound(address token) external view returns (bool);

    /// @dev Pure view: must not revert for a plain false answer.
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);

    /// @dev Post-state hooks; callable only by the bound token.
    function transferred(address from, address to, uint256 amount) external;
    function created(address to, uint256 amount) external;
    function destroyed(address from, uint256 amount) external;
}

/// @title IComplianceModule
/// @notice A rule plugged into `ICompliance`. `msg.sender` in every call is the compliance
///         contract, which modules use as the configuration key.
interface IComplianceModule {
    function moduleCheck(address from, address to, uint256 amount, address token)
        external
        view
        returns (bool);
    function moduleTransferAction(address from, address to, uint256 amount, address token) external;
    function moduleMintAction(address to, uint256 amount, address token) external;
    function moduleBurnAction(address from, uint256 amount, address token) external;
    function name() external pure returns (string memory);
}

/// @title IComplianceToken
/// @notice The subset of `AssetToken` that modules may read.
interface IComplianceToken {
    function identityRegistry() external view returns (IIdentityRegistry);
    function isComplianceExempt(address account) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
