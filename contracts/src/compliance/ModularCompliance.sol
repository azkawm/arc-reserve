// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ICompliance, IComplianceModule } from "./ICompliance.sol";

/// @title ModularCompliance
/// @notice One compliance contract per asset token. Rules live in pluggable modules that are
///         consulted on every transfer, mint, and burn of the bound token.
contract ModularCompliance is AccessControl, ICompliance {
    uint256 public constant MAX_MODULES = 16;

    address public token;
    address[] private _modules;
    mapping(address => bool) private _isModule;

    error InvalidAddress();
    error TokenAlreadyBound();
    error TokenNotBound();
    error OnlyBoundToken();
    error ModuleAlreadyAdded(address module);
    error ModuleNotFound(address module);
    error TooManyModules();

    modifier onlyToken() {
        if (msg.sender != token) revert OnlyBoundToken();
        _;
    }

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function bindToken(address token_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token_ == address(0)) revert InvalidAddress();
        if (token != address(0)) revert TokenAlreadyBound();
        token = token_;
        emit TokenBound(token_);
    }

    function unbindToken(address token_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || token != token_) revert TokenNotBound();
        token = address(0);
        emit TokenUnbound(token_);
    }

    function isTokenBound(address token_) external view returns (bool) {
        return token != address(0) && token == token_;
    }

    function addModule(address module) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (module == address(0)) revert InvalidAddress();
        if (_isModule[module]) revert ModuleAlreadyAdded(module);
        if (_modules.length >= MAX_MODULES) revert TooManyModules();
        _modules.push(module);
        _isModule[module] = true;
        emit ModuleAdded(module);
    }

    function removeModule(address module) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_isModule[module]) revert ModuleNotFound(module);
        uint256 length = _modules.length;
        for (uint256 i; i < length; ++i) {
            if (_modules[i] == module) {
                _modules[i] = _modules[length - 1];
                _modules.pop();
                break;
            }
        }
        _isModule[module] = false;
        emit ModuleRemoved(module);
    }

    function getModules() external view returns (address[] memory) {
        return _modules;
    }

    function isModuleBound(address module) external view returns (bool) {
        return _isModule[module];
    }

    function canTransfer(address from, address to, uint256 amount) external view returns (bool) {
        uint256 length = _modules.length;
        for (uint256 i; i < length; ++i) {
            if (!IComplianceModule(_modules[i]).moduleCheck(from, to, amount, token)) {
                return false;
            }
        }
        return true;
    }

    function transferred(address from, address to, uint256 amount) external onlyToken {
        uint256 length = _modules.length;
        for (uint256 i; i < length; ++i) {
            IComplianceModule(_modules[i]).moduleTransferAction(from, to, amount, token);
        }
    }

    function created(address to, uint256 amount) external onlyToken {
        uint256 length = _modules.length;
        for (uint256 i; i < length; ++i) {
            IComplianceModule(_modules[i]).moduleMintAction(to, amount, token);
        }
    }

    function destroyed(address from, uint256 amount) external onlyToken {
        uint256 length = _modules.length;
        for (uint256 i; i < length; ++i) {
            IComplianceModule(_modules[i]).moduleBurnAction(from, amount, token);
        }
    }
}
