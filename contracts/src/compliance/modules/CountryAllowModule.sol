// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IComplianceModule, IComplianceToken } from "../ICompliance.sol";
import { IIdentityRegistry } from "../IIdentityRegistry.sol";

/// @title CountryAllowModule
/// @notice Recipients must belong to an allowed jurisdiction. Configuration is keyed by the
///         compliance contract that calls the module, so one module serves many tokens.
///         Compliance-exempt infrastructure (pool, market manager) is never country-checked.
contract CountryAllowModule is AccessControl, IComplianceModule {
    bytes32 public constant MODULE_ADMIN_ROLE = keccak256("MODULE_ADMIN_ROLE");

    mapping(address => mapping(uint16 => bool)) private _allowed;
    mapping(address => uint256) public allowedCountryCount;

    event CountryAllowed(address indexed compliance, uint16 indexed country);
    event CountryDisallowed(address indexed compliance, uint16 indexed country);

    error InvalidAddress();

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MODULE_ADMIN_ROLE, admin);
    }

    function setCountryAllowed(address compliance, uint16 country, bool allowed)
        external
        onlyRole(MODULE_ADMIN_ROLE)
    {
        if (compliance == address(0)) revert InvalidAddress();
        bool current = _allowed[compliance][country];
        if (current == allowed) return;
        _allowed[compliance][country] = allowed;
        if (allowed) {
            allowedCountryCount[compliance] += 1;
            emit CountryAllowed(compliance, country);
        } else {
            allowedCountryCount[compliance] -= 1;
            emit CountryDisallowed(compliance, country);
        }
    }

    function isCountryAllowed(address compliance, uint16 country) external view returns (bool) {
        return _allowed[compliance][country];
    }

    /// @dev `msg.sender` is the compliance contract. Burns and exempt recipients pass.
    function moduleCheck(address, address to, uint256, address token) external view returns (bool) {
        if (to == address(0)) return true;
        IComplianceToken assetToken = IComplianceToken(token);
        if (assetToken.isComplianceExempt(to)) return true;
        IIdentityRegistry registry = assetToken.identityRegistry();
        if (address(registry) == address(0)) return false;
        return _allowed[msg.sender][registry.investorCountry(to)];
    }

    function moduleTransferAction(address, address, uint256, address) external { }

    function moduleMintAction(address, uint256, address) external { }

    function moduleBurnAction(address, uint256, address) external { }

    function name() external pure returns (string memory) {
        return "CountryAllowModule";
    }
}
