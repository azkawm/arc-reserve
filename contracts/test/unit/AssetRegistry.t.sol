// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { AssetRegistry } from "../../src/registry/AssetRegistry.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";

contract AssetRegistryTest is Test {
    AssetRegistry private registry;
    address private issuer = makeAddr("issuer");
    address private verifier = makeAddr("verifier");
    bytes32 private assetId;

    function setUp() public {
        vm.warp(1_800_000_000);
        registry = new AssetRegistry(address(this));
        registry.grantRole(registry.ISSUER_ROLE(), issuer);
        registry.grantRole(registry.VERIFIER_ROLE(), verifier);
        vm.prank(issuer);
        assetId = registry.submitAsset(
            "Solar Indonesia 01",
            "Renewable energy",
            "ipfs://solar",
            keccak256("metadata"),
            uint64(block.timestamp + 3 * 365 days)
        );
    }

    function testSubmitAndApproveAsset() public {
        assertEq(uint8(registry.statusOf(assetId)), uint8(IAssetRegistry.AssetStatus.Pending));
        vm.prank(verifier);
        registry.approveAsset(assetId, 1e6);
        (uint256 nav,) = registry.navOf(assetId);
        assertEq(nav, 1e6);
    }

    function testRejectsUnauthorizedApproval() public {
        vm.prank(issuer);
        vm.expectRevert();
        registry.approveAsset(assetId, 1e6);
    }

    function testRejectsExcessiveNAVMovementAndDetectsStaleness() public {
        vm.startPrank(verifier);
        registry.approveAsset(assetId, 1e6);
        vm.expectRevert(AssetRegistry.NAVMovementTooLarge.selector);
        registry.publishNAV(assetId, 1_300_000);
        registry.publishNAV(assetId, 1_100_000);
        vm.stopPrank();
        assertFalse(registry.isNAVStale(assetId));
        vm.warp(block.timestamp + 2 days + 1);
        assertTrue(registry.isNAVStale(assetId));
    }

    function testSuspendedAssetCannotIssue() public {
        vm.startPrank(verifier);
        registry.approveAsset(assetId, 1e6);
        vm.stopPrank();
        registry.grantRole(registry.FACTORY_ROLE(), address(this));
        registry.setAssetContracts(
            assetId,
            IAssetRegistry.Contracts(
                address(1), address(2), address(3), address(4), address(5), address(6)
            )
        );
        registry.activateAsset(assetId);
        vm.prank(verifier);
        registry.suspendAsset(assetId);
        assertFalse(registry.canIssue(assetId));
    }
}

