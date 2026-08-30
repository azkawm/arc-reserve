// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetFactory } from "../../src/factory/AssetFactory.sol";
import { AssetRegistry } from "../../src/registry/AssetRegistry.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-026: deployment parameters are bound to the verifier-approved term sheet. What gets
///         deployed must hash to what was approved, closing the "approved X, deployed Y" gap.
contract TermSheetBindingTest is ArcReserveTestBase {
    bytes32 internal secondAsset;

    function setUp() public override {
        super.setUp();
        secondAsset = registry.submitAsset(
            "Solar Indonesia 02",
            "Renewable energy",
            "ipfs://bafy-solar-02",
            keccak256("solar-02-metadata-v1"),
            uint64(block.timestamp + 3 * 365 days)
        );
    }

    function _params(bytes32 id) internal view returns (AssetFactory.DeploymentParams memory) {
        return AssetFactory.DeploymentParams({
            assetId: id,
            tokenName: "Solar Indonesia 02",
            tokenSymbol: "SOLAR02",
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
    }

    // -----------------------------------------------------------------
    // Approval records the hash
    // -----------------------------------------------------------------

    function test_approvalStoresAndExposesTheTermsHash() public {
        bytes32 terms = keccak256(abi.encode(_params(secondAsset)));

        vm.expectEmit(true, false, false, true, address(registry));
        emit AssetRegistry.TermsApproved(secondAsset, terms);
        registry.approveAsset(secondAsset, 1e6, terms);

        assertEq(registry.termsHashOf(secondAsset), terms);
    }

    /// @dev A zero hash would be an unbound approval, letting any parameters through.
    function test_approvalRejectsAZeroTermsHash() public {
        vm.expectRevert(AssetRegistry.InvalidTermsHash.selector);
        registry.approveAsset(secondAsset, 1e6, bytes32(0));
    }

    function test_onlyVerifierCanApprove() public {
        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, verifierRole
            )
        );
        registry.approveAsset(secondAsset, 1e6, keccak256("x"));
    }

    // -----------------------------------------------------------------
    // The factory gate
    // -----------------------------------------------------------------

    function test_matchingParamsDeploy() public {
        AssetFactory.DeploymentParams memory params = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(params)));

        AssetFactory.Deployment memory deployment = factory.deployAssetSystem(params);
        assertTrue(deployment.token != address(0));
    }

    /// @dev The whole point: approve one thing, try to deploy another.
    function test_alteredParamsAreRejected() public {
        AssetFactory.DeploymentParams memory approved = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(approved)));

        AssetFactory.DeploymentParams memory altered = approved;
        altered.maximumSupply = 1_000_000e18; // ten times the approved cap

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.deployAssetSystem(altered);
    }

    function test_aSingleChangedBasisPointIsRejected() public {
        AssetFactory.DeploymentParams memory approved = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(approved)));

        AssetFactory.DeploymentParams memory altered = approved;
        altered.minimumReserveRatioBps = 1_999;

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.deployAssetSystem(altered);
    }

    function test_aSwappedIdentityRegistryIsRejected() public {
        AssetFactory.DeploymentParams memory approved = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(approved)));

        AssetFactory.DeploymentParams memory altered = approved;
        altered.identityRegistry = address(0xdead);

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.deployAssetSystem(altered);
    }

    /// @dev Terms are checked before structural validation, so nothing unapproved gets further.
    function test_termsAreCheckedBeforeConfigurationValidation() public {
        AssetFactory.DeploymentParams memory approved = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(approved)));

        AssetFactory.DeploymentParams memory altered = approved;
        altered.tokenPrice = 0; // both unapproved and structurally invalid

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.deployAssetSystem(altered);
    }

    // -----------------------------------------------------------------
    // Amendment
    // -----------------------------------------------------------------

    function test_reapprovalRebindsBeforeDeployment() public {
        AssetFactory.DeploymentParams memory first = _params(secondAsset);
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(first)));

        AssetFactory.DeploymentParams memory amended = first;
        amended.fundraisingCap = 60_000e6;

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.deployAssetSystem(amended);

        registry.reapproveTerms(secondAsset, keccak256(abi.encode(amended)));
        assertEq(registry.termsHashOf(secondAsset), keccak256(abi.encode(amended)));

        AssetFactory.Deployment memory deployment = factory.deployAssetSystem(amended);
        assertTrue(deployment.token != address(0));
    }

    function test_reapprovalRejectsAZeroHash() public {
        registry.approveAsset(secondAsset, 1e6, keccak256("x"));
        vm.expectRevert(AssetRegistry.InvalidTermsHash.selector);
        registry.reapproveTerms(secondAsset, bytes32(0));
    }

    function test_onlyVerifierCanReapprove() public {
        registry.approveAsset(secondAsset, 1e6, keccak256("x"));
        bytes32 verifierRole = registry.VERIFIER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, verifierRole
            )
        );
        registry.reapproveTerms(secondAsset, keccak256("y"));
    }

    /// @dev Once deployed the hash describes what actually exists. Letting it drift afterwards
    ///      would make `termsHashOf` a claim nobody could rely on.
    function test_termsCannotBeAmendedAfterDeployment() public {
        AssetFactory.DeploymentParams memory params = _params(secondAsset);
        bytes32 terms = keccak256(abi.encode(params));
        registry.approveAsset(secondAsset, 1e6, terms);
        factory.deployAssetSystem(params);

        vm.expectRevert(AssetRegistry.InvalidStatus.selector);
        registry.reapproveTerms(secondAsset, keccak256("amended-after-the-fact"));
        assertEq(registry.termsHashOf(secondAsset), terms);
    }

    function test_reapprovalRequiresAnApprovedAsset() public {
        // Still Pending: nothing has been approved to amend.
        vm.expectRevert(AssetRegistry.InvalidStatus.selector);
        registry.reapproveTerms(secondAsset, keccak256("x"));
    }

    // -----------------------------------------------------------------
    // The deployed demo asset
    // -----------------------------------------------------------------

    function test_theSeededAssetIsBoundToItsDeployedParameters() public view {
        // The base fixture approves the hash of the exact params it deploys, so the stored hash
        // describes the live system.
        assertTrue(registry.termsHashOf(assetId) != bytes32(0));
        assertEq(uint8(registry.statusOf(assetId)), uint8(IAssetRegistry.AssetStatus.Active));
    }
}
