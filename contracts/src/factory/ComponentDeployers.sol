// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AssetToken } from "../token/AssetToken.sol";
import { AssetVault } from "../vault/AssetVault.sol";
import { PrimaryOffering } from "../offering/PrimaryOffering.sol";
import { RevenueDistributor } from "../revenue/RevenueDistributor.sol";
import { RedemptionController } from "../redemption/RedemptionController.sol";
import { AssetMarketManager } from "../market/AssetMarketManager.sol";
import {
    ITokenDeployer,
    IVaultDeployer,
    IOfferingDeployer,
    IRevenueDeployer,
    IRedemptionDeployer,
    IMarketDeployer
} from "../interfaces/IComponentDeployers.sol";

/// @dev Stateless component deployers keep the coordinating factory below EIP-170's code-size limit.
contract TokenDeployer is ITokenDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        bytes32 assetId,
        address registry,
        uint256 maximumSupply,
        address admin
    ) external returns (address) {
        return address(new AssetToken(name, symbol, assetId, registry, maximumSupply, admin));
    }
}

contract VaultDeployer is IVaultDeployer {
    function deploy(
        address stablecoin,
        address assetToken,
        address registry,
        bytes32 assetId,
        address issuer,
        uint16 minimumReserveRatioBps,
        address admin
    ) external returns (address) {
        return address(
            new AssetVault(
                stablecoin, assetToken, registry, assetId, issuer, minimumReserveRatioBps, admin
            )
        );
    }
}

contract OfferingDeployer is IOfferingDeployer {
    function deploy(PrimaryOffering.OfferingConfig calldata config) external returns (address) {
        return address(new PrimaryOffering(config));
    }
}

contract RevenueDeployer is IRevenueDeployer {
    function deploy(
        address stablecoin,
        address assetToken,
        address vault,
        address operator,
        address admin
    ) external returns (address) {
        return address(new RevenueDistributor(stablecoin, assetToken, vault, operator, admin));
    }
}

contract RedemptionDeployer is IRedemptionDeployer {
    function deploy(
        address assetToken,
        address vault,
        address registry,
        bytes32 assetId,
        uint64 periodDuration,
        uint256 periodLimitTokens,
        address admin
    ) external returns (address) {
        return address(
            new RedemptionController(
                assetToken, vault, registry, assetId, periodDuration, periodLimitTokens, admin
            )
        );
    }
}

contract MarketDeployer is IMarketDeployer {
    function deploy(
        address pool,
        address assetToken,
        address stablecoin,
        address vault,
        address registry,
        bytes32 assetId,
        address admin
    ) external returns (address) {
        return address(
            new AssetMarketManager(pool, assetToken, stablecoin, vault, registry, assetId, admin)
        );
    }
}
