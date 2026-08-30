// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetRegistry {
    enum AssetStatus {
        Pending,
        Approved,
        Active,
        Suspended,
        Defaulted,
        Matured,
        Closed
    }

    struct Contracts {
        address token;
        address vault;
        address offering;
        address marketManager;
        address revenueDistributor;
        address redemptionController;
    }

    function statusOf(bytes32 assetId) external view returns (AssetStatus);
    function navOf(bytes32 assetId) external view returns (uint256 nav, uint64 timestamp);
    /// @notice Hash of the verifier-approved deployment parameters (D-026).
    function termsHashOf(bytes32 assetId) external view returns (bytes32);
    function maturityOf(bytes32 assetId) external view returns (uint64);
    function issuerOf(bytes32 assetId) external view returns (address);
    function isNAVStale(bytes32 assetId) external view returns (bool);
    function canIssue(bytes32 assetId) external view returns (bool);
    function setAssetContracts(bytes32 assetId, Contracts calldata contracts_) external;
    function activateAsset(bytes32 assetId) external;
}

