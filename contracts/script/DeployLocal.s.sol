// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { MockUniswapV3Factory } from "../src/mocks/MockUniswapV3Factory.sol";
import { MockUniswapV3Pool } from "../src/mocks/MockUniswapV3Pool.sol";
import { AssetRegistry } from "../src/registry/AssetRegistry.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { RevenueDistributor } from "../src/revenue/RevenueDistributor.sol";
import { MockYieldSource } from "../src/mocks/MockYieldSource.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";
import { IdentityRegistry } from "../src/compliance/IdentityRegistry.sol";
import { ModularCompliance } from "../src/compliance/ModularCompliance.sol";
import { CountryAllowModule } from "../src/compliance/modules/CountryAllowModule.sol";
import { TransferLockModule } from "../src/compliance/modules/TransferLockModule.sol";
import { AssetFactory } from "../src/factory/AssetFactory.sol";
import {
    TokenDeployer,
    VaultDeployer,
    OfferingDeployer,
    RevenueDeployer,
    RedemptionDeployer,
    MarketDeployer
} from "../src/factory/ComponentDeployers.sol";

contract DeployLocal is Script {
    uint256 private constant DEFAULT_ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    /// @dev Anvil account #1, the demo investor. Registered as a verified Indonesian retail wallet.
    address private constant DEFAULT_ANVIL_INVESTOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint16 private constant COUNTRY_INDONESIA = 360;
    uint8 private constant CLASS_RETAIL = 1;

    address private musdAddress;
    address private mockYieldSourceAddress;
    address private registryAddress;
    address private factoryAddress;
    IdentityRegistry private identityRegistry;
    ModularCompliance private compliance;
    CountryAllowModule private countryModule;
    TransferLockModule private lockModule;

    function run() external returns (AssetFactory.Deployment memory deployment) {
        uint256 privateKey = vm.envOr("PRIVATE_KEY", DEFAULT_ANVIL_PRIVATE_KEY);
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        MockUSD musd = new MockUSD();
        AssetRegistry registry = new AssetRegistry(deployer);
        MockUniswapV3Factory poolFactory = new MockUniswapV3Factory();
        AssetFactory.ComponentDeployerSet memory deployers = AssetFactory.ComponentDeployerSet({
            token: address(new TokenDeployer()),
            vault: address(new VaultDeployer()),
            offering: address(new OfferingDeployer()),
            revenue: address(new RevenueDeployer()),
            redemption: address(new RedemptionDeployer()),
            market: address(new MarketDeployer())
        });
        AssetFactory factory =
            new AssetFactory(address(registry), address(musd), deployer, deployers);
        registry.grantRole(registry.FACTORY_ROLE(), address(factory));
        factory.setApprovedPoolFactory(address(poolFactory), true);
        musdAddress = address(musd);
        registryAddress = address(registry);
        factoryAddress = address(factory);

        // Protocol-wide KYC registry. The deployer (issuer/verifier/keeper) and the demo investor
        // are the only verified wallets; every other address is blocked from holding SOLAR01.
        identityRegistry = new IdentityRegistry(deployer);
        identityRegistry.registerIdentity(deployer, deployer, COUNTRY_INDONESIA, CLASS_RETAIL, 0);
        address investor = vm.envOr("DEMO_INVESTOR", DEFAULT_ANVIL_INVESTOR);
        identityRegistry.registerIdentity(investor, investor, COUNTRY_INDONESIA, CLASS_RETAIL, 0);

        uint64 maturity = uint64(block.timestamp + 3 * 365 days);
        bytes32 assetId = registry.submitAsset(
            "Solar Indonesia 01",
            "Renewable energy",
            "ipfs://bafy-arc-reserve-solar-indonesia-01",
            keccak256("solar-indonesia-01-metadata-v1"),
            maturity
        );
        registry.approveAsset(assetId, 1e6);

        deployment = factory.deployAssetSystem(
            AssetFactory.DeploymentParams({
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
                operator: deployer,
                revenueDepositor: deployer,
                poolFactory: address(poolFactory),
                poolFee: 3_000,
                initialSqrtPriceX96: uint160(1 << 96),
                identityRegistry: address(identityRegistry)
            })
        );

        _configureCompliance(deployer, deployment);
        _configureMarket(deployment);

        musd.faucet(deployer, 100_000e6);
        musd.approve(deployment.vault, type(uint256).max);
        AssetVault(deployment.vault).depositInitialReserve(20_000e6);

        // D-023 sinking-fund schedule: backing climbs linearly from 0.30 to 1.00 mUSD per investor
        // token over the three-year term, with a 30-day grace window before a shortfall freezes
        // issuer proceeds.
        // The 0.30 start matches the D-023 settlement holdback exactly: a raise with no seed
        // capital lands at 0.30 backing. DEMO: in the target model this is set once at settlement
        // from the backing the raise actually produced. Here the 20,000 seed puts a full 80,000
        // raise near 0.55, comfortably ahead of the schedule at day zero.
        AssetVault(deployment.vault)
            .setReserveSchedule(300_000, 1_000_000, uint64(block.timestamp), maturity, 30 days);

        // D-022 reporting cadence: a revenue report every 30 days, with a 30-day grace window
        // before `isReportingOverdue()` flags the issuer to the verifier and the UI.
        RevenueDistributor(deployment.revenueDistributor).setReportingPolicy(30 days, 30 days);

        // D-023 maturity window: 90 days after the asset's maturity date for holders to redeem at
        // par, after which the issuer may reclaim the leftover reserve.
        AssetVault(deployment.vault).setMaturityWindow(90 days);

        // D-023 reserve yield. DEMO: a stand-in for holding the reserve in a yield-bearing stable.
        // Yield lands in the reserve while backing is behind schedule and with the issuer once it
        // is on or ahead. Seeded with 5,000 mUSD so the demo can show both branches.
        MockYieldSource yieldSource = new MockYieldSource(address(musd), deployment.vault);
        mockYieldSourceAddress = address(yieldSource);
        AssetVault(deployment.vault)
            .grantRole(AssetVault(deployment.vault).YIELD_SOURCE_ROLE(), mockYieldSourceAddress);
        musd.faucet(mockYieldSourceAddress, 5_000e6);
        vm.stopBroadcast();

        _writeDeployment(assetId, deployment);
        console2.log("ArcReserve local demo deployed");
        console2.logBytes32(assetId);
        console2.log("mUSD", musdAddress);
        console2.log("Registry", registryAddress);
        console2.log("SOLAR01", deployment.token);
        console2.log("Vault", deployment.vault);
        console2.log("Offering", deployment.offering);
        console2.log("ARC Engine", deployment.marketManager);
        console2.log("Identity registry", address(identityRegistry));
        console2.log("Compliance", address(compliance));
    }

    function _configureMarket(AssetFactory.Deployment memory deployment) private {
        AssetMarketManager market = AssetMarketManager(deployment.marketManager);
        int24 oneDollarTick = market.assetIsToken0() ? int24(-276_324) : int24(276_324);
        MockUniswapV3Pool(deployment.pool).setOracleForTest(oneDollarTick, oneDollarTick);
        if (market.assetIsToken0()) {
            market.configureCorePositions(-278_400, -276_600, -276_600, -276_000);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, -276_000, -274_800
            );
        } else {
            market.configureCorePositions(274_800, 276_000, 276_000, 276_600);
            market.configureOptionalPosition(
                AssetMarketManager.PositionKind.Discovery, 276_600, 278_400
            );
        }
    }

    /// @dev Modular compliance for the series: Indonesia-only recipients, and a resale hold
    ///      period that is disabled (0) for the demo so the market path can be exercised.
    function _configureCompliance(address deployer, AssetFactory.Deployment memory deployment)
        private
    {
        compliance = new ModularCompliance(deployer);
        countryModule = new CountryAllowModule(deployer);
        lockModule = new TransferLockModule(deployer);
        countryModule.setCountryAllowed(address(compliance), COUNTRY_INDONESIA, true);
        lockModule.setHoldPeriod(address(compliance), 0);
        compliance.addModule(address(countryModule));
        compliance.addModule(address(lockModule));
        compliance.bindToken(deployment.token);
        AssetToken(deployment.token).setCompliance(address(compliance));
    }

    // D-031: there is no company/issuer token allocation. The issuer is paid in cash (settlement
    // proceeds, operator revenue share, residual reserve at close), so nothing is minted here and
    // the offering is the only holder of ISSUANCE_CONTROLLER_ROLE for the life of the asset.
    // Of the 100,000 authorized supply, 80,000 is offering inventory and 20,000 stays unminted
    // headroom (D-002, D-004).

    function _writeDeployment(bytes32 assetId, AssetFactory.Deployment memory deployment) private {
        string memory root = "arcReserve";
        vm.serializeBytes32(root, "assetId", assetId);
        vm.serializeAddress(root, "mockUSD", musdAddress);
        vm.serializeAddress(root, "registry", registryAddress);
        vm.serializeAddress(root, "factory", factoryAddress);
        vm.serializeAddress(root, "mockYieldSource", mockYieldSourceAddress);
        vm.serializeAddress(root, "identityRegistry", address(identityRegistry));
        vm.serializeAddress(root, "compliance", address(compliance));
        vm.serializeAddress(root, "countryAllowModule", address(countryModule));
        vm.serializeAddress(root, "transferLockModule", address(lockModule));
        vm.serializeAddress(root, "token", deployment.token);
        vm.serializeAddress(root, "vault", deployment.vault);
        vm.serializeAddress(root, "offering", deployment.offering);
        vm.serializeAddress(root, "marketManager", deployment.marketManager);
        vm.serializeAddress(root, "revenueDistributor", deployment.revenueDistributor);
        vm.serializeAddress(root, "redemptionController", deployment.redemptionController);
        string memory json = vm.serializeAddress(root, "pool", deployment.pool);
        vm.writeJson(json, "deployments/31337.json");
    }
}
