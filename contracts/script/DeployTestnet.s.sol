// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { MockUSD } from "../src/mocks/MockUSD.sol";
import { MockUniswapV3Factory } from "../src/mocks/MockUniswapV3Factory.sol";
import { MockUniswapV3Pool } from "../src/mocks/MockUniswapV3Pool.sol";
import { AssetRegistry } from "../src/registry/AssetRegistry.sol";
import { AssetVault } from "../src/vault/AssetVault.sol";
import { AssetToken } from "../src/token/AssetToken.sol";
import { RevenueDistributor } from "../src/revenue/RevenueDistributor.sol";
import { PrimaryOffering } from "../src/offering/PrimaryOffering.sol";
import { MockYieldSource } from "../src/mocks/MockYieldSource.sol";
import { FloorController } from "../src/market/FloorController.sol";
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

/// @title DeployTestnet
/// @notice D-027 testnet deployment for Base Sepolia (84532) and Hedera testnet (296).
///         Anvil (31337) keeps `DeployLocal`; every other chain id is refused.
///
///         Differences from `DeployLocal`, each deliberate:
///         - `PRIVATE_KEY` is REQUIRED (no fallback), and the well-known Anvil dev keys are
///           refused when broadcasting: on a public chain the Anvil #0 fallback would hand
///           protocol admin to a publicly known key.
///         - Base Sepolia uses the canonical Uniswap V3 factory
///           (verified 2026-09-11 from Uniswap's official deployments page and on-chain:
///           `feeAmountTickSpacing(3000) == 60`). Hedera has no verified V3-compatible factory,
///           so it deploys the mock factory (D-027).
///         - On a canonical pool there is no `setOracleForTest`: the pool is initialized at the
///           true one-mUSD price for the actual token ordering, and observation cardinality is
///           grown so the 30-minute TWAP can start accumulating. Until observations age, the
///           market manager's TWAP-gated operations revert with the pool's `OLD` error —
///           expected on a fresh pool, not a defect.
///         - No demo liquidity seeding on a canonical pool (`DEMO_SEED_LIQUIDITY` applies to the
///           mock path only): the mock's deterministic mint/swap arithmetic does not hold on a
///           real AMM, and TWAP gates block funding on a fresh pool anyway.
///         - `DEMO_INVESTOR` / `DEMO_RETAIL` have no Anvil defaults here; unset means only the
///           deployer is registered in the identity registry.
contract DeployTestnet is Script {
    uint256 private constant CHAIN_BASE_SEPOLIA = 84_532;
    uint256 private constant CHAIN_HEDERA_TESTNET = 296;

    /// @dev Uniswap v3 factory on Base Sepolia. Chain-specific: the SAME address is Uniswap's
    ///      V2 Router02 on Base mainnet — never copy it to another chain by pattern.
    ///      Source: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
    address private constant BASE_SEPOLIA_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

    uint16 private constant COUNTRY_INDONESIA = 360;
    uint8 private constant CLASS_RETAIL = 1;
    uint8 private constant CLASS_ACCREDITED = 2;
    uint8 private constant CLASS_INSTITUTIONAL = 3;
    uint256 private constant Q96 = 1 << 96;

    address private deployer;
    address private musdAddress;
    address private tokenDeployerAddress;
    address private mockYieldSourceAddress;
    address private floorControllerAddress;
    address private registryAddress;
    address private factoryAddress;
    address private poolFactoryAddress;
    bool private poolIsCanonical;
    bool private predictedAssetIsToken0;
    uint64 private maturity;
    bytes32 private assetId;
    IdentityRegistry private identityRegistry;
    ModularCompliance private compliance;
    CountryAllowModule private countryModule;
    TransferLockModule private lockModule;

    function run() external returns (AssetFactory.Deployment memory deployment) {
        require(
            block.chainid == CHAIN_BASE_SEPOLIA || block.chainid == CHAIN_HEDERA_TESTNET,
            "DeployTestnet: unsupported chain (use DeployLocal for 31337; D-027 forbids mainnet)"
        );
        poolIsCanonical = block.chainid == CHAIN_BASE_SEPOLIA;

        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(
            privateKey != 0,
            "DeployTestnet: PRIVATE_KEY is required (contracts/.env.example) - no fallback on public chains"
        );
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(
                !_isKnownAnvilKey(privateKey),
                "DeployTestnet: refusing to broadcast with a well-known Anvil dev key (D-027)"
            );
        }
        deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        AssetFactory factory = _deployCore();
        _registerIdentities();
        AssetFactory.DeploymentParams memory params = _buildParams();
        // D-026: the verifier approves the hash of the exact parameters that will be deployed.
        AssetRegistry(registryAddress).approveAsset(assetId, 1e6, keccak256(abi.encode(params)));
        deployment = factory.deployAssetSystem(params);
        require(
            AssetMarketManager(deployment.marketManager).assetIsToken0() == predictedAssetIsToken0,
            "DeployTestnet: token-ordering prediction failed; pool initialized at the wrong price"
        );

        _configureCompliance(deployment);
        _configureMarket(deployment);
        _fundReserveAndPolicies(deployment);
        _configureYield(deployment);
        _configureFloor(deployment);
        _maybeSeedLiquidity(deployment);
        vm.stopBroadcast();

        _writeDeployment(deployment);
        _log(deployment);
    }

    function _deployCore() private returns (AssetFactory factory) {
        MockUSD musd = new MockUSD();
        AssetRegistry registry = new AssetRegistry(deployer);
        AssetFactory.ComponentDeployerSet memory deployers = AssetFactory.ComponentDeployerSet({
            token: address(new TokenDeployer()),
            vault: address(new VaultDeployer()),
            offering: address(new OfferingDeployer()),
            revenue: address(new RevenueDeployer()),
            redemption: address(new RedemptionDeployer()),
            market: address(new MarketDeployer())
        });
        factory = new AssetFactory(address(registry), address(musd), deployer, deployers);
        registry.grantRole(registry.FACTORY_ROLE(), address(factory));
        poolFactoryAddress =
            poolIsCanonical ? BASE_SEPOLIA_V3_FACTORY : address(new MockUniswapV3Factory());
        factory.setApprovedPoolFactory(poolFactoryAddress, true);

        musdAddress = address(musd);
        registryAddress = address(registry);
        factoryAddress = address(factory);
        tokenDeployerAddress = deployers.token;
    }

    function _registerIdentities() private {
        identityRegistry = new IdentityRegistry(deployer);
        identityRegistry.registerIdentity(
            deployer, deployer, COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0
        );
        address investor = vm.envOr("DEMO_INVESTOR", address(0));
        if (investor != address(0)) {
            identityRegistry.registerIdentity(
                investor, investor, COUNTRY_INDONESIA, CLASS_ACCREDITED, 0
            );
        }
        address retail = vm.envOr("DEMO_RETAIL", address(0));
        if (retail != address(0)) {
            identityRegistry.registerIdentity(retail, retail, COUNTRY_INDONESIA, CLASS_RETAIL, 0);
        }
    }

    function _buildParams() private returns (AssetFactory.DeploymentParams memory params) {
        // The pool's token ordering decides which side of the price the initializer encodes.
        // The asset token does not exist yet, but its address is deterministic: it is the first
        // CREATE of the fresh TokenDeployer (contract nonce 1). Verified against the deployed
        // manager in `run`.
        predictedAssetIsToken0 = vm.computeCreateAddress(tokenDeployerAddress, 1) < musdAddress;
        maturity = uint64(block.timestamp + 3 * 365 days);
        assetId = AssetRegistry(registryAddress)
            .submitAsset(
                "Solar Indonesia 01",
                "Renewable energy",
                "ipfs://bafy-arc-reserve-solar-indonesia-01",
                keccak256("solar-indonesia-01-metadata-v1"),
                maturity
            );
        params = AssetFactory.DeploymentParams({
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
            poolFactory: poolFactoryAddress,
            poolFee: 3_000,
            // 1.000000 mUSD per whole 18-decimal token, exact for either token ordering:
            // raw token1/token0 ratio is 1e-12 (asset first) or 1e12 (stable first).
            initialSqrtPriceX96: predictedAssetIsToken0 ? uint160(Q96 / 1e6) : uint160(Q96 * 1e6),
            identityRegistry: address(identityRegistry)
        });
    }

    /// @dev Same modular compliance as the local demo: Indonesia-only recipients, resale hold 0.
    function _configureCompliance(AssetFactory.Deployment memory deployment) private {
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

    function _configureMarket(AssetFactory.Deployment memory deployment) private {
        AssetMarketManager market = AssetMarketManager(deployment.marketManager);
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
        if (poolIsCanonical) {
            // Real pool: no test oracle. Grow the observation ring so the 30-minute TWAP can
            // accumulate; the manager's TWAP-gated paths stay dormant until it has.
            (bool ok,) = deployment.pool
                .call(
                    abi.encodeWithSignature(
                        "increaseObservationCardinalityNext(uint16)", uint16(60)
                    )
                );
            require(ok, "DeployTestnet: increaseObservationCardinalityNext failed");
        } else {
            int24 oneDollarTick = market.assetIsToken0() ? int24(-276_324) : int24(276_324);
            MockUniswapV3Pool(deployment.pool).setOracleForTest(oneDollarTick, oneDollarTick);
        }
    }

    /// @dev D-023 / D-022 / D-028 policies: identical to the local demo configuration.
    function _fundReserveAndPolicies(AssetFactory.Deployment memory deployment) private {
        MockUSD musd = MockUSD(musdAddress);
        musd.faucet(deployer, 100_000e6);
        musd.approve(deployment.vault, type(uint256).max);
        AssetVault(deployment.vault).depositInitialReserve(20_000e6);

        AssetVault(deployment.vault)
            .setReserveSchedule(300_000, 1_000_000, uint64(block.timestamp), maturity, 30 days);
        RevenueDistributor(deployment.revenueDistributor).setReportingPolicy(30 days, 30 days);
        PrimaryOffering offering = PrimaryOffering(deployment.offering);
        offering.setClassLimit(CLASS_RETAIL, 5_000e6, 0);
        offering.setClassLimit(CLASS_ACCREDITED, 50_000e6, 0);
        offering.setClassLimit(CLASS_INSTITUTIONAL, type(uint256).max, 0);
        AssetVault(deployment.vault).setMaturityWindow(90 days);
    }

    /// @dev D-023 reserve yield. DEMO: stand-in yield source, as in DeployLocal.
    function _configureYield(AssetFactory.Deployment memory deployment) private {
        MockYieldSource yieldSource = new MockYieldSource(musdAddress, deployment.vault);
        mockYieldSourceAddress = address(yieldSource);
        AssetVault(deployment.vault)
            .grantRole(AssetVault(deployment.vault).YIELD_SOURCE_ROLE(), mockYieldSourceAddress);
        MockUSD(musdAddress).faucet(mockYieldSourceAddress, 5_000e6);
    }

    /// @dev D-025 published floor, same start level and cooldown as the local demo.
    function _configureFloor(AssetFactory.Deployment memory deployment) private {
        AssetMarketManager market = AssetMarketManager(deployment.marketManager);
        bool assetIsToken0 = market.assetIsToken0();
        FloorController floorController = new FloorController(
            deployment.vault,
            registryAddress,
            assetId,
            assetIsToken0,
            market.tickSpacing(),
            assetIsToken0 ? int24(-288_420) : int24(288_420),
            30 minutes,
            deployer
        );
        floorControllerAddress = address(floorController);
        market.setFloorController(floorControllerAddress);
    }

    /// @dev Mock-pool chains only; see the canonical-path skip reason in the contract natspec.
    function _maybeSeedLiquidity(AssetFactory.Deployment memory deployment) private {
        if (!vm.envOr("DEMO_SEED_LIQUIDITY", false)) return;
        if (poolIsCanonical) {
            console2.log(
                "DEMO_SEED_LIQUIDITY skipped: canonical pool (mock-only arithmetic; TWAP gates block funding on a fresh pool)"
            );
            return;
        }
        AssetMarketManager market = AssetMarketManager(deployment.marketManager);
        MockUSD musd = MockUSD(musdAddress);

        musd.faucet(deployer, 10_000e6);
        musd.approve(deployment.offering, 10_000e6);
        PrimaryOffering(deployment.offering).buy(10_000e6, 0);

        market.fundFromVault(500e6);
        AssetToken(deployment.token).approve(deployment.marketManager, 500e18);
        market.fundTokenInventory(500e18);
        market.addLiquidity(
            AssetMarketManager.AddLiquidityParams({
                kind: AssetMarketManager.PositionKind.Anchor,
                liquidity: 1_000,
                maxAmount0: 500e18,
                maxAmount1: 500e18,
                minimumAmount0: 0,
                minimumAmount1: 0,
                deadline: block.timestamp + 1 hours
            })
        );
    }

    function _writeDeployment(AssetFactory.Deployment memory deployment) private {
        string memory root = "arcReserve";
        vm.serializeBytes32(root, "assetId", assetId);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeBool(root, "poolIsCanonical", poolIsCanonical);
        vm.serializeAddress(root, "poolFactory", poolFactoryAddress);
        vm.serializeAddress(root, "mockUSD", musdAddress);
        vm.serializeAddress(root, "registry", registryAddress);
        vm.serializeAddress(root, "factory", factoryAddress);
        vm.serializeAddress(root, "mockYieldSource", mockYieldSourceAddress);
        vm.serializeAddress(root, "floorController", floorControllerAddress);
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
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _log(AssetFactory.Deployment memory deployment) private view {
        console2.log("ArcReserve testnet deployment complete, chain", block.chainid);
        console2.logBytes32(assetId);
        console2.log("mUSD", musdAddress);
        console2.log("Registry", registryAddress);
        console2.log("SOLAR01", deployment.token);
        console2.log("Vault", deployment.vault);
        console2.log("Offering", deployment.offering);
        console2.log("ARC Engine", deployment.marketManager);
        console2.log("Pool", deployment.pool);
        console2.log("Pool factory", poolFactoryAddress);
        console2.log("Pool is canonical", poolIsCanonical);
        console2.log("Identity registry", address(identityRegistry));
        console2.log("Compliance", address(compliance));
    }

    /// @dev The ten dev keys of Anvil's default mnemonic ("test test ... junk"). Publicly known;
    ///      broadcasting protocol-admin power from any of them on a public chain is unrecoverable.
    function _isKnownAnvilKey(uint256 pk) private pure returns (bool) {
        return pk == 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            || pk == 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
            || pk == 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
            || pk == 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
            || pk == 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
            || pk == 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
            || pk == 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
            || pk == 0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356
            || pk == 0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97
            || pk == 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6;
    }
}
