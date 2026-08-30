// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";

contract AssetRegistry is AccessControl, Pausable, IAssetRegistry {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant REVENUE_DEPOSITOR_ROLE = keccak256("REVENUE_DEPOSITOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    struct Asset {
        bytes32 id;
        address issuer;
        string name;
        string category;
        string metadataURI;
        bytes32 metadataHash;
        uint256 verifiedNAV;
        uint64 navTimestamp;
        uint64 maturityTimestamp;
        /// @notice keccak256 of the `AssetFactory.DeploymentParams` the verifier approved (D-026).
        ///         Frozen once the system is deployed, so it always describes what actually exists.
        bytes32 termsHash;
        AssetStatus status;
        Contracts contracts_;
    }

    mapping(bytes32 => Asset) private _assets;
    mapping(address => uint256) public issuerNonces;

    uint32 public navStaleAfter = 2 days;
    uint16 public maxNAVMovementBps = 2_000;

    event AssetSubmitted(
        bytes32 indexed assetId,
        address indexed issuer,
        string name,
        string category,
        string metadataURI,
        bytes32 metadataHash,
        uint64 maturityTimestamp
    );
    event AssetStatusChanged(
        bytes32 indexed assetId, AssetStatus previousStatus, AssetStatus newStatus
    );
    event NAVUpdated(
        bytes32 indexed assetId, uint256 previousNAV, uint256 newNAV, uint64 timestamp
    );
    event AssetContractsSet(bytes32 indexed assetId, Contracts contracts_);
    event OraclePolicyUpdated(uint32 staleAfter, uint16 maxMovementBps);
    event TermsApproved(bytes32 indexed assetId, bytes32 termsHash);

    error UnknownAsset();
    error InvalidStatus();
    error InvalidMaturity();
    error InvalidNAV();
    error InvalidTermsHash();
    error NAVMovementTooLarge();
    error ContractsAlreadySet();
    error InvalidAddress();

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
        _grantRole(REVENUE_DEPOSITOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function submitAsset(
        string calldata name,
        string calldata category,
        string calldata metadataURI,
        bytes32 metadataHash,
        uint64 maturityTimestamp
    ) external onlyRole(ISSUER_ROLE) whenNotPaused returns (bytes32 assetId) {
        if (maturityTimestamp <= block.timestamp) revert InvalidMaturity();
        uint256 nonce = ++issuerNonces[msg.sender];
        assetId = keccak256(abi.encode(block.chainid, msg.sender, nonce, metadataHash));
        Asset storage asset = _assets[assetId];
        asset.id = assetId;
        asset.issuer = msg.sender;
        asset.name = name;
        asset.category = category;
        asset.metadataURI = metadataURI;
        asset.metadataHash = metadataHash;
        asset.maturityTimestamp = maturityTimestamp;
        asset.status = AssetStatus.Pending;
        emit AssetSubmitted(
            assetId, msg.sender, name, category, metadataURI, metadataHash, maturityTimestamp
        );
    }

    /// @notice Approve an asset and bind it to the term sheet the verifier reviewed (D-026).
    /// @param  termsHash `keccak256(abi.encode(AssetFactory.DeploymentParams))`. The factory
    ///         refuses to deploy anything that does not hash to this, closing the
    ///         "approved X, deployed Y" gap. A zero hash is rejected rather than treated as
    ///         unbound - an unbound approval would let any parameters through.
    function approveAsset(bytes32 assetId, uint256 initialNAV, bytes32 termsHash)
        external
        onlyRole(VERIFIER_ROLE)
    {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Pending) revert InvalidStatus();
        if (initialNAV == 0) revert InvalidNAV();
        if (termsHash == bytes32(0)) revert InvalidTermsHash();
        AssetStatus previous = asset.status;
        asset.status = AssetStatus.Approved;
        asset.verifiedNAV = initialNAV;
        asset.navTimestamp = uint64(block.timestamp);
        asset.termsHash = termsHash;
        emit NAVUpdated(assetId, 0, initialNAV, uint64(block.timestamp));
        emit TermsApproved(assetId, termsHash);
        emit AssetStatusChanged(assetId, previous, AssetStatus.Approved);
    }

    /// @notice Amend the approved term sheet before the system is deployed.
    /// @dev    Deliberately restricted to `Approved`. Once `setAssetContracts` has run the hash
    ///         describes what was actually deployed, and letting it drift afterwards would make
    ///         `termsHashOf` a claim nobody could rely on. A post-deployment amendment is an
    ///         offchain legal event; re-binding it onchain would require redeploying the series.
    function reapproveTerms(bytes32 assetId, bytes32 newTermsHash)
        external
        onlyRole(VERIFIER_ROLE)
    {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Approved) revert InvalidStatus();
        if (newTermsHash == bytes32(0)) revert InvalidTermsHash();
        asset.termsHash = newTermsHash;
        emit TermsApproved(assetId, newTermsHash);
    }

    function termsHashOf(bytes32 assetId) external view returns (bytes32) {
        return _requireAsset(assetId).termsHash;
    }

    function rejectAsset(bytes32 assetId) external onlyRole(VERIFIER_ROLE) {
        _setStatus(assetId, AssetStatus.Pending, AssetStatus.Closed);
    }

    function publishNAV(bytes32 assetId, uint256 newNAV) external onlyRole(VERIFIER_ROLE) {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Approved && asset.status != AssetStatus.Active) {
            revert InvalidStatus();
        }
        if (newNAV == 0) revert InvalidNAV();
        uint256 previous = asset.verifiedNAV;
        if (previous != 0 && DecimalMath.deviationBps(newNAV, previous) > maxNAVMovementBps) {
            revert NAVMovementTooLarge();
        }
        asset.verifiedNAV = newNAV;
        asset.navTimestamp = uint64(block.timestamp);
        emit NAVUpdated(assetId, previous, newNAV, uint64(block.timestamp));
    }

    function setAssetContracts(bytes32 assetId, Contracts calldata contracts_)
        external
        onlyRole(FACTORY_ROLE)
    {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Approved) revert InvalidStatus();
        if (asset.contracts_.token != address(0)) revert ContractsAlreadySet();
        if (
            contracts_.token == address(0) || contracts_.vault == address(0)
                || contracts_.offering == address(0) || contracts_.marketManager == address(0)
                || contracts_.revenueDistributor == address(0)
                || contracts_.redemptionController == address(0)
        ) revert InvalidAddress();
        asset.contracts_ = contracts_;
        emit AssetContractsSet(assetId, contracts_);
    }

    function activateAsset(bytes32 assetId) external onlyRole(FACTORY_ROLE) {
        _setStatus(assetId, AssetStatus.Approved, AssetStatus.Active);
    }

    function suspendAsset(bytes32 assetId) external onlyRole(VERIFIER_ROLE) {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Active) revert InvalidStatus();
        AssetStatus previous = asset.status;
        asset.status = AssetStatus.Suspended;
        emit AssetStatusChanged(assetId, previous, AssetStatus.Suspended);
    }

    function resumeAsset(bytes32 assetId) external onlyRole(VERIFIER_ROLE) {
        _setStatus(assetId, AssetStatus.Suspended, AssetStatus.Active);
    }

    function markDefault(bytes32 assetId) external onlyRole(VERIFIER_ROLE) {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != AssetStatus.Active && asset.status != AssetStatus.Suspended) {
            revert InvalidStatus();
        }
        AssetStatus previous = asset.status;
        asset.status = AssetStatus.Defaulted;
        emit AssetStatusChanged(assetId, previous, AssetStatus.Defaulted);
    }

    function markMatured(bytes32 assetId) external onlyRole(VERIFIER_ROLE) {
        Asset storage asset = _requireAsset(assetId);
        if (block.timestamp < asset.maturityTimestamp) revert InvalidMaturity();
        if (asset.status != AssetStatus.Active && asset.status != AssetStatus.Suspended) {
            revert InvalidStatus();
        }
        AssetStatus previous = asset.status;
        asset.status = AssetStatus.Matured;
        emit AssetStatusChanged(assetId, previous, AssetStatus.Matured);
    }

    function closeAsset(bytes32 assetId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Asset storage asset = _requireAsset(assetId);
        AssetStatus previous = asset.status;
        asset.status = AssetStatus.Closed;
        emit AssetStatusChanged(assetId, previous, AssetStatus.Closed);
    }

    function setOraclePolicy(uint32 staleAfter, uint16 movementBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (staleAfter == 0 || movementBps == 0 || movementBps > 10_000) {
            revert InvalidNAV();
        }
        navStaleAfter = staleAfter;
        maxNAVMovementBps = movementBps;
        emit OraclePolicyUpdated(staleAfter, movementBps);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function getAsset(bytes32 assetId) external view returns (Asset memory) {
        Asset storage asset = _requireAsset(assetId);
        return asset;
    }

    function statusOf(bytes32 assetId) external view returns (AssetStatus) {
        return _requireAsset(assetId).status;
    }

    function navOf(bytes32 assetId) external view returns (uint256 nav, uint64 timestamp) {
        Asset storage asset = _requireAsset(assetId);
        return (asset.verifiedNAV, asset.navTimestamp);
    }

    function maturityOf(bytes32 assetId) external view returns (uint64) {
        return _requireAsset(assetId).maturityTimestamp;
    }

    function issuerOf(bytes32 assetId) external view returns (address) {
        return _requireAsset(assetId).issuer;
    }

    function isNAVStale(bytes32 assetId) public view returns (bool) {
        Asset storage asset = _requireAsset(assetId);
        return asset.navTimestamp == 0 || block.timestamp > asset.navTimestamp + navStaleAfter;
    }

    function canIssue(bytes32 assetId) external view returns (bool) {
        Asset storage asset = _requireAsset(assetId);
        return asset.status == AssetStatus.Active && block.timestamp < asset.maturityTimestamp;
    }

    function _setStatus(bytes32 assetId, AssetStatus expected, AssetStatus next) private {
        Asset storage asset = _requireAsset(assetId);
        if (asset.status != expected) revert InvalidStatus();
        asset.status = next;
        emit AssetStatusChanged(assetId, expected, next);
    }

    function _requireAsset(bytes32 assetId) private view returns (Asset storage asset) {
        asset = _assets[assetId];
        if (asset.id == bytes32(0)) revert UnknownAsset();
    }
}

