// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PrimaryOffering } from "../offering/PrimaryOffering.sol";

interface ITokenDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        bytes32 assetId,
        address registry,
        uint256 maximumSupply,
        address admin
    ) external returns (address);
}

interface IVaultDeployer {
    function deploy(
        address stablecoin,
        address assetToken,
        address registry,
        bytes32 assetId,
        address issuer,
        uint16 minimumReserveRatioBps,
        address admin
    ) external returns (address);
}

interface IOfferingDeployer {
    function deploy(PrimaryOffering.OfferingConfig calldata config) external returns (address);
}

interface IRevenueDeployer {
    function deploy(
        address stablecoin,
        address assetToken,
        address vault,
        address operator,
        address admin
    ) external returns (address);
}

interface IRedemptionDeployer {
    function deploy(
        address assetToken,
        address vault,
        address registry,
        bytes32 assetId,
        uint64 periodDuration,
        uint256 periodLimitTokens,
        address admin
    ) external returns (address);
}

interface IMarketDeployer {
    function deploy(
        address pool,
        address assetToken,
        address stablecoin,
        address vault,
        address registry,
        bytes32 assetId,
        address admin
    ) external returns (address);
}
