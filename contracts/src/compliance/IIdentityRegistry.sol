// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIdentityRegistry
/// @notice ERC-3643-shaped identity registry. Wallets are bound to a verified identity with a
///         jurisdiction, an investor class, and an optional claim expiry. Any registry that
///         exposes `isVerified` and `investorCountry` (T-REX, ATS) can replace this one.
interface IIdentityRegistry {
    event IdentityRegistered(address indexed investorAddress, address indexed identity);
    event IdentityRemoved(address indexed investorAddress, address indexed identity);
    event IdentityUpdated(address indexed investorAddress, address indexed newIdentity);
    event CountryUpdated(address indexed investorAddress, uint16 indexed country);
    event InvestorClassUpdated(address indexed investorAddress, uint8 investorClass);
    event ClaimExpiryUpdated(address indexed investorAddress, uint64 expiresAt);

    /// @return True when the wallet is registered and its claim has not expired.
    function isVerified(address userAddress) external view returns (bool);
    function contains(address userAddress) external view returns (bool);
    function identity(address userAddress) external view returns (address);
    /// @return ISO 3166-1 numeric country code (e.g. 360 = Indonesia).
    function investorCountry(address userAddress) external view returns (uint16);
    /// @return Deployment-defined class (e.g. 1 retail, 2 accredited, 3 institutional).
    function investorClass(address userAddress) external view returns (uint8);
    /// @return Unix timestamp after which the claim is stale; 0 means no expiry.
    function claimExpiresAt(address userAddress) external view returns (uint64);
}
