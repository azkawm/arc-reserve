// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { MockUniswapV3Factory } from "../src/mocks/MockUniswapV3Factory.sol";
import { MockUniswapV3Pool } from "../src/mocks/MockUniswapV3Pool.sol";
import { AssetRegistry } from "../src/registry/AssetRegistry.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { PrimaryOffering } from "../src/offering/PrimaryOffering.sol";
import { RevenueDistributor } from "../src/revenue/RevenueDistributor.sol";
import { RedemptionController } from "../src/redemption/RedemptionController.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";
import { AssetFactory } from "../src/factory/AssetFactory.sol";
import {
    TokenDeployer,
    VaultDeployer,
    OfferingDeployer,
    RevenueDeployer,
    RedemptionDeployer,
    MarketDeployer
} from "../src/factory/ComponentDeployers.sol";
import { IAssetRegistry } from "../src/interfaces/IAssetRegistry.sol";
import { IdentityRegistry } from "../src/compliance/IdentityRegistry.sol";

abstract contract ArcReserveTestBase is Test {
    uint16 internal constant COUNTRY_INDONESIA = 360;
    uint8 internal constant CLASS_RETAIL = 1;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal attacker = makeAddr("attacker"); // never KYC'd

    MockUSD internal musd;
    AssetRegistry internal registry;
    IdentityRegistry internal identityRegistry;
    AssetFactory internal factory;
    MockUniswapV3Factory internal poolFactory;
    bytes32 internal assetId;

    AssetToken internal token;
    AssetVault internal vault;
    PrimaryOffering internal offering;
    RevenueDistributor internal revenue;
    RedemptionController internal redemption;
    AssetMarketManager internal market;
    MockUniswapV3Pool internal pool;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        musd = new MockUSD();
        registry = new AssetRegistry(address(this));
        identityRegistry = new IdentityRegistry(address(this));
        _verify(alice);
        _verify(bob);
        _verify(address(this));
        poolFactory = new MockUniswapV3Factory();

        AssetFactory.ComponentDeployerSet memory deployers = AssetFactory.ComponentDeployerSet({
            token: address(new TokenDeployer()),
            vault: address(new VaultDeployer()),
            offering: address(new OfferingDeployer()),
            revenue: address(new RevenueDeployer()),
            redemption: address(new RedemptionDeployer()),
            market: address(new MarketDeployer())
        });
        factory = new AssetFactory(address(registry), address(musd), address(this), deployers);
        registry.grantRole(registry.FACTORY_ROLE(), address(factory));
        factory.setApprovedPoolFactory(address(poolFactory), true);

        assetId = registry.submitAsset(
            "Solar Indonesia 01",
            "Renewable energy",
            "ipfs://bafy-arc-reserve-solar-indonesia-01",
            keccak256("solar-indonesia-01-metadata-v1"),
            uint64(block.timestamp + 3 * 365 days)
        );
        AssetFactory.DeploymentParams memory params = AssetFactory.DeploymentParams({
            assetId: assetId,
            tokenName: "Solar Indonesia 01",
            tokenSymbol: "SOLAR01",
            maximumSupply: 100_000e18,
            minimumReserveRatioBps: 2_000,
            offeringStartsAt: uint64(block.timestamp),
            offeringEndsAt: uint64(block.timestamp + 30 days),
            tokenPrice: 1e6,
            fundraisingCap: 80_000e6,
            walletPurchaseLimit: 50_000e6,
            offeringInventory: 80_000e18,
            minimumPurchase: 1e6,
            redemptionPeriodDuration: 1 days,
            redemptionPeriodLimitTokens: 25_000e18,
            operator: address(this),
            revenueDepositor: address(this),
            poolFactory: address(poolFactory),
            poolFee: 3_000,
            initialSqrtPriceX96: uint160(1 << 96),
            identityRegistry: address(identityRegistry)
        });
        // D-026: the params ARE the term sheet, so they are hashed and approved before deployment.
        registry.approveAsset(assetId, 1e6, keccak256(abi.encode(params)));
        AssetFactory.Deployment memory deployment = factory.deployAssetSystem(params);
        token = AssetToken(deployment.token);
        vault = AssetVault(deployment.vault);
        offering = PrimaryOffering(deployment.offering);
        revenue = RevenueDistributor(deployment.revenueDistributor);
        redemption = RedemptionController(deployment.redemptionController);
        market = AssetMarketManager(deployment.marketManager);
        pool = MockUniswapV3Pool(deployment.pool);

        _setOneDollarOracle(0);

        musd.faucet(address(this), 100_000e6);
        musd.approve(address(vault), type(uint256).max);
        vault.depositInitialReserve(20_000e6);
    }

    function _verify(address who) internal {
        if (!identityRegistry.contains(who)) {
            identityRegistry.registerIdentity(who, who, COUNTRY_INDONESIA, CLASS_RETAIL, 0);
        }
    }

    function _buy(address buyer, uint256 stableAmount) internal {
        musd.faucet(buyer, stableAmount);
        vm.startPrank(buyer);
        musd.approve(address(offering), stableAmount);
        offering.buy(stableAmount, 0);
        vm.stopPrank();
    }

    function _depositRevenue(uint256 amount) internal {
        _depositRevenue(amount, 1);
    }

    function _depositRevenue(uint256 amount, uint256 periodId) internal {
        musd.faucet(address(this), amount);
        musd.approve(address(revenue), amount);
        revenue.depositRevenue(amount, periodId, keccak256(abi.encode("report", periodId)));
    }

    function _setOneDollarOracle(int24 spotOffset) internal {
        int24 oneDollarTick = market.assetIsToken0() ? int24(-276_324) : int24(276_324);
        int24 directedOffset = market.assetIsToken0() ? spotOffset : -spotOffset;
        pool.setOracleForTest(oneDollarTick + directedOffset, oneDollarTick);
    }

    function _configurePositions() internal {
        if (market.assetIsToken0()) {
            market.configureCorePositions(-278_400, -276_600, -276_600, -276_000);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, -276_000, -274_800
            );
        } else {
            // Higher tick = LOWER asset price when the stable is token0: reserve floor at the
            // high-tick end, discovery at the low-tick end (fixed 2026-09-12; was inverted).
            market.configureCorePositions(276_600, 278_400, 276_000, 276_600);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, 274_800, 276_000
            );
        }
    }
}

