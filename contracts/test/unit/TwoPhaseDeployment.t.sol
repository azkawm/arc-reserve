// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Vm } from "forge-std/Test.sol";
import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetFactory } from "../../src/factory/AssetFactory.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { PrimaryOffering } from "../../src/offering/PrimaryOffering.sol";
import { RevenueDistributor } from "../../src/revenue/RevenueDistributor.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice D-033: the factory deploys in two transactions because one does not fit under either
///         chain's per-transaction gas cap. These tests pin the phase boundary, the window between
///         the phases, and the escape hatch out of it.
contract TwoPhaseDeploymentTest is ArcReserveTestBase {
    /// @dev Hedera's per-transaction cap, the tighter of the two. Base Sepolia enforces EIP-7825's
    ///      2^24 = 16,777,216.
    uint256 internal constant HEDERA_TX_GAS_CAP = 15_000_000;
    uint256 internal constant BASE_TX_GAS_CAP = 16_777_216;

    bytes32 internal pendingAsset;
    AssetFactory.DeploymentParams internal pendingParams;

    function setUp() public override {
        super.setUp();
        (pendingAsset, pendingParams) = _submitAndApprove("Solar Indonesia 02", "SOLAR02");
    }

    function _submitAndApprove(string memory name, string memory symbol)
        internal
        returns (bytes32 id, AssetFactory.DeploymentParams memory params)
    {
        id = registry.submitAsset(
            name,
            "Renewable energy",
            "ipfs://bafy-two-phase",
            keccak256(abi.encode(symbol)),
            uint64(block.timestamp + 3 * 365 days)
        );
        params = AssetFactory.DeploymentParams({
            assetId: id,
            tokenName: name,
            tokenSymbol: symbol,
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
        registry.approveAsset(id, 1e6, keccak256(abi.encode(params)));
    }

    function _begin() internal returns (AssetFactory.PendingDeployment memory) {
        return factory.beginAssetSystem(pendingParams);
    }

    // -----------------------------------------------------------------
    // Phase 1
    // -----------------------------------------------------------------

    function test_phaseOneDeploysFourComponentsAndLeavesTheAssetApproved() public {
        AssetFactory.PendingDeployment memory pending = _begin();

        assertTrue(pending.token != address(0));
        assertTrue(pending.vault != address(0));
        assertTrue(pending.offering != address(0));
        assertTrue(pending.revenueDistributor != address(0));
        assertEq(pending.initiator, address(this));
        assertEq(pending.termsHash, keccak256(abi.encode(pendingParams)));

        // Nothing is live: the registry has not been told, and the asset has not been activated.
        assertEq(uint8(registry.statusOf(pendingAsset)), uint8(IAssetRegistry.AssetStatus.Approved));
        assertFalse(registry.canIssue(pendingAsset));
        assertTrue(factory.isPending(pendingAsset));
        (address deployedToken,,,,,,) = factory.deployments(pendingAsset);
        assertEq(deployedToken, address(0));
    }

    function test_phaseOneEmitsBegun() public {
        // Addresses are not known in advance, so only the indexed asset and issuer are checked.
        vm.expectEmit(true, true, false, false, address(factory));
        emit AssetFactory.AssetSystemBegun(
            pendingAsset, address(this), address(0), address(0), address(0), address(0)
        );
        _begin();
    }

    function test_phaseOneWiresWhatItCan() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        AssetToken t = AssetToken(pending.token);
        AssetVault v = AssetVault(pending.vault);

        assertTrue(t.hasRole(t.ISSUANCE_CONTROLLER_ROLE(), pending.offering));
        assertEq(address(t.identityRegistry()), address(identityRegistry));
        assertTrue(v.hasRole(v.ALLOCATOR_ROLE(), pending.offering));
        assertTrue(v.hasRole(v.ALLOCATOR_ROLE(), pending.revenueDistributor));
        assertTrue(v.hasRole(v.REVENUE_DEPOSITOR_ROLE(), address(this)));
    }

    function test_cannotBeginTwice() public {
        _begin();
        vm.expectRevert(AssetFactory.AlreadyBegun.selector);
        factory.beginAssetSystem(pendingParams);
    }

    function test_cannotBeginAnAlreadyDeployedAsset() public {
        // The completed-deployment check runs before the status gate, so the revert names the
        // actual problem rather than the downstream symptom.
        AssetFactory.DeploymentParams memory params = pendingParams;
        params.assetId = assetId;
        vm.expectRevert(AssetFactory.AlreadyDeployed.selector);
        factory.beginAssetSystem(params);
    }

    // -----------------------------------------------------------------
    // The window between the phases
    // -----------------------------------------------------------------

    function test_vaultRefusesInitialReserveBetweenPhases() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        musd.faucet(address(this), 1_000e6);
        musd.approve(pending.vault, type(uint256).max);

        vm.expectRevert(AssetVault.SystemNotActive.selector);
        AssetVault(pending.vault).depositInitialReserve(1_000e6);
        assertEq(AssetVault(pending.vault).totalStablecoinBalance(), 0);
    }

    function test_vaultRefusesScheduledReserveBetweenPhases() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        musd.faucet(address(this), 1_000e6);
        musd.approve(pending.vault, type(uint256).max);

        vm.expectRevert(AssetVault.SystemNotActive.selector);
        AssetVault(pending.vault).depositReserve(1_000e6, 1);
    }

    /// @dev This is the one that actually needed a gate: phase 1 grants `REVENUE_DEPOSITOR_ROLE`,
    ///      so without the check the role holder could push funds into a vault with no redemption
    ///      controller and no way out.
    function test_vaultRefusesAssetRevenueBetweenPhases() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        AssetVault v = AssetVault(pending.vault);
        assertTrue(v.hasRole(v.REVENUE_DEPOSITOR_ROLE(), address(this)));

        musd.faucet(address(this), 1_000e6);
        musd.approve(pending.vault, type(uint256).max);
        vm.expectRevert(AssetVault.SystemNotActive.selector);
        v.depositAssetRevenue(1_000e6);
    }

    function test_offeringCannotSellBetweenPhases() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        musd.faucet(alice, 1_000e6);
        vm.startPrank(alice);
        musd.approve(pending.offering, 1_000e6);
        vm.expectRevert(PrimaryOffering.AssetNotActive.selector);
        PrimaryOffering(pending.offering).buy(1_000e6, 0);
        vm.stopPrank();
    }

    /// @dev The counterpart: the gate lifts the moment phase 2 activates the asset, and it does
    ///      NOT come back for suspended/defaulted/matured assets - a suspended asset in shortfall
    ///      can only be cured by a deposit.
    function test_depositsWorkOnceActiveAndStillWorkWhileSuspended() public {
        _begin();
        factory.completeAssetSystem(pendingAsset, pendingParams);
        (, address vaultAddress,,,,,) = factory.deployments(pendingAsset);
        AssetVault v = AssetVault(vaultAddress);

        musd.faucet(address(this), 5_000e6);
        musd.approve(vaultAddress, type(uint256).max);
        v.depositInitialReserve(1_000e6);
        assertEq(v.redemptionReserve(), 1_000e6);

        registry.suspendAsset(pendingAsset);
        v.depositReserve(1_000e6, 1);
        assertEq(v.redemptionReserve(), 2_000e6);
    }

    // -----------------------------------------------------------------
    // Phase 2
    // -----------------------------------------------------------------

    function test_phaseTwoActivatesAndEmitsDeployedExactlyOnce() public {
        _begin();

        vm.recordLogs();
        AssetFactory.Deployment memory deployment =
            factory.completeAssetSystem(pendingAsset, pendingParams);

        assertTrue(deployment.redemptionController != address(0));
        assertTrue(deployment.marketManager != address(0));
        assertTrue(deployment.pool != address(0));
        assertEq(uint8(registry.statusOf(pendingAsset)), uint8(IAssetRegistry.AssetStatus.Active));
        assertFalse(factory.isPending(pendingAsset));

        uint256 deployedEvents;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(factory)
                    && logs[i].topics[0] == AssetFactory.AssetSystemDeployed.selector
            ) deployedEvents++;
        }
        assertEq(deployedEvents, 1, "AssetSystemDeployed must fire exactly once");
    }

    function test_phaseTwoCarriesThePhaseOneComponentsForward() public {
        AssetFactory.PendingDeployment memory pending = _begin();
        AssetFactory.Deployment memory deployment =
            factory.completeAssetSystem(pendingAsset, pendingParams);

        assertEq(deployment.token, pending.token);
        assertEq(deployment.vault, pending.vault);
        assertEq(deployment.offering, pending.offering);
        assertEq(deployment.revenueDistributor, pending.revenueDistributor);
    }

    function test_cannotCompleteWithoutBeginning() public {
        vm.expectRevert(AssetFactory.NotBegun.selector);
        factory.completeAssetSystem(pendingAsset, pendingParams);
    }

    /// @dev The architect's refinement: phase 2 belongs to the wallet that ran phase 1, not to
    ///      whoever `registry.issuerOf` happens to name at the time.
    function test_phaseTwoIsBoundToThePhaseOneCaller() public {
        _begin();
        factory.grantRole(factory.ISSUER_ROLE(), bob);

        vm.prank(bob);
        vm.expectRevert(AssetFactory.UnauthorizedIssuer.selector);
        factory.completeAssetSystem(pendingAsset, pendingParams);
    }

    function test_phaseTwoRejectsAlteredParams() public {
        _begin();
        AssetFactory.DeploymentParams memory altered = pendingParams;
        altered.redemptionPeriodLimitTokens = 99_000e18;

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.completeAssetSystem(pendingAsset, altered);
    }

    /// @dev Re-approving between the phases must not let a different system through: phase 2
    ///      checks the hash phase 1 recorded, not the registry's current one.
    function test_reapprovalBetweenPhasesCannotSwapTheSystem() public {
        _begin();
        AssetFactory.DeploymentParams memory amended = pendingParams;
        amended.fundraisingCap = 60_000e6;
        registry.reapproveTerms(pendingAsset, keccak256(abi.encode(amended)));

        vm.expectRevert(AssetFactory.TermsMismatch.selector);
        factory.completeAssetSystem(pendingAsset, amended);
    }

    /// @dev Reaching the cross-check needs two systems pending at once. With only one, an assetId
    ///      that has no pending record trips `NotBegun` first - which is the case below it.
    function test_phaseTwoRejectsAMismatchedAssetId() public {
        _begin();
        (, AssetFactory.DeploymentParams memory otherParams) =
            _submitAndApprove("Solar Indonesia 04", "SOLAR04");
        factory.beginAssetSystem(otherParams);

        vm.expectRevert(AssetFactory.AssetIdMismatch.selector);
        factory.completeAssetSystem(pendingAsset, otherParams);
    }

    function test_completingAnAssetWithNoPendingRecordIsRefused() public {
        _begin();
        vm.expectRevert(AssetFactory.NotBegun.selector);
        factory.completeAssetSystem(assetId, pendingParams);
    }

    function test_factoryKeepsNoRolesAfterPhaseTwo() public {
        _begin();
        AssetFactory.Deployment memory d = factory.completeAssetSystem(pendingAsset, pendingParams);
        AssetToken t = AssetToken(d.token);
        AssetVault v = AssetVault(d.vault);
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertFalse(t.hasRole(t.PAUSER_ROLE(), address(factory)));
        assertFalse(v.hasRole(v.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertTrue(t.hasRole(t.DEFAULT_ADMIN_ROLE(), address(this)));
    }

    // -----------------------------------------------------------------
    // Abandon
    // -----------------------------------------------------------------

    function test_abandonClearsThePendingRecordAndRenouncesEverything() public {
        AssetFactory.PendingDeployment memory pending = _begin();

        vm.expectEmit(true, true, false, false, address(factory));
        emit AssetFactory.AssetSystemAbandoned(pendingAsset, address(this));
        factory.abandonAssetSystem(pendingAsset);

        assertFalse(factory.isPending(pendingAsset));

        AssetToken t = AssetToken(pending.token);
        AssetVault v = AssetVault(pending.vault);
        PrimaryOffering o = PrimaryOffering(pending.offering);
        RevenueDistributor r = RevenueDistributor(pending.revenueDistributor);
        assertFalse(t.hasRole(t.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertFalse(t.hasRole(t.PAUSER_ROLE(), address(factory)));
        assertFalse(v.hasRole(v.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertFalse(v.hasRole(v.PAUSER_ROLE(), address(factory)));
        assertFalse(o.hasRole(o.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertFalse(r.hasRole(r.DEFAULT_ADMIN_ROLE(), address(factory)));
        assertFalse(r.hasRole(r.REVENUE_DEPOSITOR_ROLE(), address(factory)));
    }

    function test_theFactoryAdminCanAbandonSomeoneElsesPendingSystem() public {
        factory.grantRole(factory.ISSUER_ROLE(), bob);
        registry.grantRole(registry.ISSUER_ROLE(), bob);
        vm.prank(bob);
        bytes32 bobAsset = registry.submitAsset(
            "Solar Indonesia 03",
            "Renewable energy",
            "ipfs://bafy-bob",
            keccak256("bob-03"),
            uint64(block.timestamp + 3 * 365 days)
        );
        AssetFactory.DeploymentParams memory params = pendingParams;
        params.assetId = bobAsset;
        params.tokenSymbol = "SOLAR03";
        registry.approveAsset(bobAsset, 1e6, keccak256(abi.encode(params)));
        vm.prank(bob);
        factory.beginAssetSystem(params);

        // `address(this)` is the factory admin, not the initiator.
        factory.abandonAssetSystem(bobAsset);
        assertFalse(factory.isPending(bobAsset));
    }

    function test_abandonRejectsAStranger() public {
        _begin();
        vm.prank(attacker);
        vm.expectRevert(AssetFactory.UnauthorizedIssuer.selector);
        factory.abandonAssetSystem(pendingAsset);
    }

    function test_abandonRequiresAPendingRecord() public {
        vm.expectRevert(AssetFactory.NotBegun.selector);
        factory.abandonAssetSystem(pendingAsset);
    }

    function test_completingAnAbandonedSystemIsRefused() public {
        _begin();
        factory.abandonAssetSystem(pendingAsset);
        vm.expectRevert(AssetFactory.NotBegun.selector);
        factory.completeAssetSystem(pendingAsset, pendingParams);
    }

    /// @dev The recovery path end to end: abandon frees the factory, then the registry admin closes
    ///      the asset. There is no TTL - this is the deliberate way out.
    function test_afterAbandonTheRegistryAdminCanCloseTheAsset() public {
        _begin();
        factory.abandonAssetSystem(pendingAsset);
        registry.closeAsset(pendingAsset);
        assertEq(uint8(registry.statusOf(pendingAsset)), uint8(IAssetRegistry.AssetStatus.Closed));
    }

    /// @dev Abandoning does not consume the asset's approval on the registry side, so a fresh
    ///      phase 1 can be started against the same (still Approved) asset.
    function test_abandonAllowsAFreshStart() public {
        AssetFactory.PendingDeployment memory first = _begin();
        factory.abandonAssetSystem(pendingAsset);

        AssetFactory.PendingDeployment memory second = _begin();
        assertTrue(second.token != first.token);
        AssetFactory.Deployment memory d = factory.completeAssetSystem(pendingAsset, pendingParams);
        assertEq(d.token, second.token);
        assertEq(uint8(registry.statusOf(pendingAsset)), uint8(IAssetRegistry.AssetStatus.Active));
    }

    // -----------------------------------------------------------------
    // The reason the split exists
    // -----------------------------------------------------------------

    /// @notice Each phase must fit under BOTH per-transaction caps. Measured against the mock pool
    ///         factory; creating a canonical Uniswap V3 pool adds roughly 4.3M to phase 2 (the
    ///         pool's own code deposit), which is why phase 2 is also held well under the caps.
    function test_eachPhaseFitsUnderBothChainGasCaps() public {
        uint256 before = gasleft();
        factory.beginAssetSystem(pendingParams);
        uint256 phaseOne = before - gasleft();

        before = gasleft();
        factory.completeAssetSystem(pendingAsset, pendingParams);
        uint256 phaseTwo = before - gasleft();

        emit log_named_uint("phase 1 gas (mock pool)", phaseOne);
        emit log_named_uint("phase 2 gas (mock pool)", phaseTwo);

        assertLt(phaseOne, HEDERA_TX_GAS_CAP, "phase 1 over Hedera cap");
        assertLt(phaseOne, BASE_TX_GAS_CAP, "phase 1 over Base cap");
        assertLt(phaseTwo, HEDERA_TX_GAS_CAP, "phase 2 over Hedera cap");
        // Headroom for the canonical pool's code deposit on Base Sepolia.
        assertLt(phaseTwo, 10_500_000, "phase 2 leaves too little canonical-pool headroom");
    }

    function test_onlyAnIssuerRoleHolderCanBegin() public {
        bytes32 issuerRole = factory.ISSUER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, issuerRole
            )
        );
        factory.beginAssetSystem(pendingParams);
    }
}
