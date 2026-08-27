// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { MockUniswapV3Factory } from "../src/mocks/MockUniswapV3Factory.sol";
import { MockUniswapV3Pool } from "../src/mocks/MockUniswapV3Pool.sol";
import { AssetRegistry } from "../src/registry/AssetRegistry.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { AssetMarketManager } from "../src/market/AssetMarketManager.sol";
import { RevenueDistributor } from "../src/revenue/RevenueDistributor.sol";
import { CompanyVestingWallet } from "../src/vesting/CompanyVestingWallet.sol";
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

    address private companyVestingAddress;
    address private musdAddress;
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

        bytes32 assetId = registry.submitAsset(
            "Solar Indonesia 01",
            "Renewable energy",
            "ipfs://bafy-arc-reserve-solar-indonesia-01",
            keccak256("solar-indonesia-01-metadata-v1"),
            uint64(block.timestamp + 3 * 365 days)
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
        _configureCompanyVesting(deployer, deployment);
        _configureMarket(deployment);

        musd.faucet(deployer, 100_000e6);
        musd.approve(deployment.vault, type(uint256).max);
        AssetVault(deployment.vault).depositInitialReserve(20_000e6);
        vm.stopBroadcast();

        _writeDeployment(assetId, deployment);
        console2.log("ArcReserve local demo deployed");
        console2.logBytes32(assetId);
        console2.log("mUSD", musdAddress);
        console2.log("Registry", registryAddress);
        console2.log("SOLAR01", deployment.token);
        console2.log("Vault", deployment.vault);
        console2.log("Offering", deployment.offering);
        console2.log("Company vesting", companyVestingAddress);
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

    function _configureCompanyVesting(address deployer, AssetFactory.Deployment memory deployment)
        private
    {
        CompanyVestingWallet companyVesting =
            new CompanyVestingWallet(deployer, uint64(block.timestamp), uint64(365 days));
        companyVestingAddress = address(companyVesting);

        RevenueDistributor revenue = RevenueDistributor(deployment.revenueDistributor);
        AssetToken assetToken = AssetToken(deployment.token);
        revenue.setYieldExcluded(companyVestingAddress, true);
        // The vesting wallet is issuer infrastructure, not an investor; its beneficiary is KYC'd.
        assetToken.setComplianceExempt(companyVestingAddress, true);
        assetToken.grantRole(assetToken.ISSUANCE_CONTROLLER_ROLE(), deployer);
        assetToken.mint(companyVestingAddress, 20_000e18);
        assetToken.revokeRole(assetToken.ISSUANCE_CONTROLLER_ROLE(), deployer);
    }

    function _writeDeployment(bytes32 assetId, AssetFactory.Deployment memory deployment) private {
        string memory root = "arcReserve";
        vm.serializeBytes32(root, "assetId", assetId);
        vm.serializeAddress(root, "mockUSD", musdAddress);
        vm.serializeAddress(root, "registry", registryAddress);
        vm.serializeAddress(root, "factory", factoryAddress);
        vm.serializeAddress(root, "companyVesting", companyVestingAddress);
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
