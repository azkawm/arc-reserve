// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IIdentityRegistry } from "./IIdentityRegistry.sol";

/// @title IdentityRegistry
/// @notice Protocol-wide KYC registry shared by every asset series. A KYC provider holding
///         `REGISTRY_AGENT_ROLE` binds wallets to a verified identity. The registry stores no
///         personal data: only the offchain identity reference, jurisdiction, class, and expiry.
contract IdentityRegistry is AccessControl, IIdentityRegistry {
    bytes32 public constant REGISTRY_AGENT_ROLE = keccak256("REGISTRY_AGENT_ROLE");

    struct Identity {
        address onchainId;
        uint16 country;
        uint8 investorClass;
        uint64 expiresAt;
        bool registered;
    }

    mapping(address => Identity) private _identities;
    uint256 public identityCount;

    error InvalidAddress();
    error AlreadyRegistered(address wallet);
    error NotRegistered(address wallet);
    error InvalidExpiry();
    error LengthMismatch();

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRY_AGENT_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Agent writes
    // ---------------------------------------------------------------------

    function registerIdentity(
        address wallet,
        address onchainId,
        uint16 country,
        uint8 investorClass_,
        uint64 expiresAt
    ) public onlyRole(REGISTRY_AGENT_ROLE) {
        if (wallet == address(0)) revert InvalidAddress();
        if (_identities[wallet].registered) revert AlreadyRegistered(wallet);
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _identities[wallet] = Identity({
            onchainId: onchainId,
            country: country,
            investorClass: investorClass_,
            expiresAt: expiresAt,
            registered: true
        });
        identityCount += 1;
        emit IdentityRegistered(wallet, onchainId);
        emit CountryUpdated(wallet, country);
        emit InvestorClassUpdated(wallet, investorClass_);
        emit ClaimExpiryUpdated(wallet, expiresAt);
    }

    function batchRegisterIdentity(
        address[] calldata wallets,
        address[] calldata onchainIds,
        uint16[] calldata countries,
        uint8[] calldata investorClasses,
        uint64[] calldata expiries
    ) external onlyRole(REGISTRY_AGENT_ROLE) {
        uint256 length = wallets.length;
        if (
            onchainIds.length != length || countries.length != length
                || investorClasses.length != length || expiries.length != length
        ) revert LengthMismatch();
        for (uint256 i; i < length; ++i) {
            registerIdentity(
                wallets[i], onchainIds[i], countries[i], investorClasses[i], expiries[i]
            );
        }
    }

    function deleteIdentity(address wallet) external onlyRole(REGISTRY_AGENT_ROLE) {
        Identity memory existing = _identities[wallet];
        if (!existing.registered) revert NotRegistered(wallet);
        delete _identities[wallet];
        identityCount -= 1;
        emit IdentityRemoved(wallet, existing.onchainId);
    }

    function updateIdentity(address wallet, address newOnchainId)
        external
        onlyRole(REGISTRY_AGENT_ROLE)
    {
        _requireRegistered(wallet);
        _identities[wallet].onchainId = newOnchainId;
        emit IdentityUpdated(wallet, newOnchainId);
    }

    function updateCountry(address wallet, uint16 country) external onlyRole(REGISTRY_AGENT_ROLE) {
        _requireRegistered(wallet);
        _identities[wallet].country = country;
        emit CountryUpdated(wallet, country);
    }

    function updateInvestorClass(address wallet, uint8 investorClass_)
        external
        onlyRole(REGISTRY_AGENT_ROLE)
    {
        _requireRegistered(wallet);
        _identities[wallet].investorClass = investorClass_;
        emit InvestorClassUpdated(wallet, investorClass_);
    }

    /// @notice Extend or shorten a claim. Passing a past timestamp suspends the wallet without
    ///         deleting its record; passing 0 removes the expiry.
    function updateClaimExpiry(address wallet, uint64 expiresAt)
        external
        onlyRole(REGISTRY_AGENT_ROLE)
    {
        _requireRegistered(wallet);
        _identities[wallet].expiresAt = expiresAt;
        emit ClaimExpiryUpdated(wallet, expiresAt);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isVerified(address userAddress) external view returns (bool) {
        Identity storage record = _identities[userAddress];
        if (!record.registered) return false;
        return record.expiresAt == 0 || record.expiresAt > block.timestamp;
    }

    function contains(address userAddress) external view returns (bool) {
        return _identities[userAddress].registered;
    }

    function identity(address userAddress) external view returns (address) {
        return _identities[userAddress].onchainId;
    }

    function investorCountry(address userAddress) external view returns (uint16) {
        return _identities[userAddress].country;
    }

    function investorClass(address userAddress) external view returns (uint8) {
        return _identities[userAddress].investorClass;
    }

    function claimExpiresAt(address userAddress) external view returns (uint64) {
        return _identities[userAddress].expiresAt;
    }

    function getIdentity(address userAddress) external view returns (Identity memory) {
        return _identities[userAddress];
    }

    function _requireRegistered(address wallet) private view {
        if (!_identities[wallet].registered) revert NotRegistered(wallet);
    }
}
