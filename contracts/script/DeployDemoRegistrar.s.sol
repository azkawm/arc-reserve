// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { IdentityRegistry } from "../src/compliance/IdentityRegistry.sol";
import { DemoRegistrar } from "../src/compliance/DemoRegistrar.sol";

/// @title  DeployDemoRegistrar
/// @notice D-034: attach the permissionless KYC stub to an ALREADY DEPLOYED system.
///
/// @dev    Separate from `DeployTestnet` on purpose. The live system does not need redeploying to
///         gain this, and redeploying to add it would discard every wallet already verified on the
///         existing `IdentityRegistry`. Two small transactions instead: deploy the registrar, then
///         grant it `REGISTRY_AGENT_ROLE`.
///
///         SEQUENCING — READ THIS BEFORE RUNNING. A full redeploy of the asset system creates a
///         **new** `IdentityRegistry`. Running this script against the old one and then redeploying
///         strands every judge who self-registered and wastes the grant. If a redeploy is planned,
///         run this AFTER it, against the new registry.
///
///         Usage:
///           PRIVATE_KEY=... forge script script/DeployDemoRegistrar.s.sol:DeployDemoRegistrar \
///             --rpc-url <url> --broadcast --slow
///
///         The identity registry is read from `deployments/<chainId>.json`, which is the source of
///         truth every other stack uses; `IDENTITY_REGISTRY` overrides it for a one-off.
contract DeployDemoRegistrar is Script {
    uint256 private constant CHAIN_ANVIL = 31_337;
    uint256 private constant CHAIN_BASE_SEPOLIA = 84_532;
    uint256 private constant CHAIN_HEDERA_TESTNET = 296;

    uint256 private constant DEFAULT_ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external returns (address registrarAddress) {
        require(
            block.chainid == CHAIN_ANVIL || block.chainid == CHAIN_BASE_SEPOLIA
                || block.chainid == CHAIN_HEDERA_TESTNET,
            "DeployDemoRegistrar: testnets only (D-027)"
        );

        uint256 privateKey = _privateKey();
        address deployer = vm.addr(privateKey);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        address identityRegistry = _identityRegistry(path);

        IdentityRegistry registry = IdentityRegistry(identityRegistry);
        bytes32 agentRole = registry.REGISTRY_AGENT_ROLE();
        require(
            registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer),
            "DeployDemoRegistrar: deployer does not hold DEFAULT_ADMIN_ROLE on the identity registry"
        );

        // Idempotent: a registrar already attached to THIS registry is left alone. Deploying a
        // second one would leave two agents holding the same role over the same registry, which is
        // the standing-privilege smell D-032 exists to avoid.
        address existing = _existingRegistrar(path);
        if (
            existing != address(0) && existing.code.length != 0
                && address(DemoRegistrar(existing).identityRegistry()) == identityRegistry
                && registry.hasRole(agentRole, existing)
        ) {
            console2.log("DemoRegistrar already attached; nothing to do", existing);
            return existing;
        }

        vm.startBroadcast(privateKey);
        DemoRegistrar registrar = new DemoRegistrar(identityRegistry);
        registry.grantRole(agentRole, address(registrar));
        vm.stopBroadcast();

        registrarAddress = address(registrar);
        require(registrar.isActive(), "DeployDemoRegistrar: grant did not take effect");

        vm.writeJson(string.concat('"', vm.toString(registrarAddress), '"'), path, ".demoRegistrar");

        console2.log("Chain", block.chainid);
        console2.log("Identity registry", identityRegistry);
        console2.log("DemoRegistrar", registrarAddress);
        console2.log("DEMO: anyone can now self-verify on this chain. Label it that way.");
    }

    function _privateKey() private view returns (uint256 privateKey) {
        if (block.chainid == CHAIN_ANVIL) {
            return vm.envOr("PRIVATE_KEY", DEFAULT_ANVIL_PRIVATE_KEY);
        }
        privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(privateKey != 0, "DeployDemoRegistrar: PRIVATE_KEY is required off Anvil");
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            require(
                privateKey != DEFAULT_ANVIL_PRIVATE_KEY,
                "DeployDemoRegistrar: refusing to broadcast with the well-known Anvil key (D-027)"
            );
        }
    }

    function _identityRegistry(string memory path) private view returns (address identityRegistry) {
        identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        if (identityRegistry == address(0)) {
            identityRegistry = vm.parseJsonAddress(vm.readFile(path), ".identityRegistry");
        }
        require(identityRegistry != address(0), "DeployDemoRegistrar: identity registry unknown");
        require(
            identityRegistry.code.length != 0,
            "DeployDemoRegistrar: no contract at the identity registry address"
        );
    }

    /// @dev Reads the recorded registrar if the deployment file already names one. A missing key is
    ///      the normal first-run case, not an error.
    function _existingRegistrar(string memory path) private view returns (address) {
        address fromEnv = vm.envOr("DEMO_REGISTRAR", address(0));
        if (fromEnv != address(0)) return fromEnv;
        string memory json = vm.readFile(path);
        if (!vm.keyExistsJson(json, ".demoRegistrar")) return address(0);
        return vm.parseJsonAddress(json, ".demoRegistrar");
    }
}
