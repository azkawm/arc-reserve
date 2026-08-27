// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IIdentityRegistry } from "../IIdentityRegistry.sol";

/// @title AtsExternalKycList
/// @notice Exposes the ArcReserve `IdentityRegistry` through the interface that Hedera Asset
///         Tokenization Studio tokens consume as an *external KYC list*
///         (`IExternalKycList.getKycStatus`). Register this contract's address in an ATS token's
///         `externalKycLists` and the same KYC decisions gate both ArcReserve and ATS securities.
///         Mirrors `IKyc.KycStatus` from ATS: 0 = NOT_GRANTED, 1 = GRANTED.
contract AtsExternalKycList {
    enum KycStatus {
        NOT_GRANTED,
        GRANTED
    }

    IIdentityRegistry public immutable identityRegistry;

    error InvalidAddress();

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) revert InvalidAddress();
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    function getKycStatus(address account) external view returns (KycStatus) {
        return identityRegistry.isVerified(account) ? KycStatus.GRANTED : KycStatus.NOT_GRANTED;
    }
}
