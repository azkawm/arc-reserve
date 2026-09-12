// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { AssetFactory } from "../../src/factory/AssetFactory.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { ModularCompliance } from "../../src/compliance/ModularCompliance.sol";
import { CountryAllowModule } from "../../src/compliance/modules/CountryAllowModule.sol";
import { TransferLockModule } from "../../src/compliance/modules/TransferLockModule.sol";
import { AtsExternalKycList } from "../../src/compliance/adapters/AtsExternalKycList.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @dev Permissioned-transfer behaviour of AssetToken, including the canonical pool sitting
///      inside the compliance perimeter as exempt infrastructure.
contract ComplianceGateTest is ArcReserveTestBase {
    uint16 private constant COUNTRY_SINGAPORE = 702;

    ModularCompliance private compliance;
    CountryAllowModule private countryModule;
    TransferLockModule private lockModule;

    function setUp() public override {
        super.setUp();
        _buy(alice, 10_000e6);
    }

    // ------------------------------------------------------------------
    // Identity gate
    // ------------------------------------------------------------------

    function testFactoryWiresRegistryAndExemptsInfrastructure() public view {
        assertEq(address(token.identityRegistry()), address(identityRegistry));
        assertTrue(token.isComplianceExempt(address(market)));
        assertTrue(token.isComplianceExempt(address(pool)));
        assertFalse(token.isComplianceExempt(alice));
        assertTrue(token.hasRole(token.TRANSFER_AGENT_ROLE(), address(this)));
    }

    function testFactoryRejectsMissingIdentityRegistry() public {
        bytes32 secondAsset = registry.submitAsset(
            "Solar Indonesia 02",
            "Renewable energy",
            "ipfs://two",
            keccak256("two"),
            uint64(block.timestamp + 3 * 365 days)
        );
        AssetFactory.DeploymentParams memory params = _paramsFor(secondAsset);
        params.identityRegistry = address(0);
        // Approve the hash of these exact (broken) params, so the D-026 gate passes and the
        // configuration validation behind it is what rejects them. Structural validation is a real
        // second line of defence, not something the terms binding makes redundant.
        registry.approveAsset(secondAsset, 1e6, keccak256(abi.encode(params)));
        vm.expectRevert(AssetFactory.InvalidConfiguration.selector);
        factory.beginAssetSystem(params);
    }

    function testUnverifiedWalletCannotBuy() public {
        musd.faucet(attacker, 100e6);
        vm.startPrank(attacker);
        musd.approve(address(offering), 100e6);
        vm.expectRevert(AssetToken.RecipientNotVerified.selector);
        offering.buy(100e6, 0);
        vm.stopPrank();
        assertEq(token.balanceOf(attacker), 0);
    }

    function testVerifiedHolderCannotSendToUnverifiedWallet() public {
        assertEq(
            token.transferRestriction(alice, attacker, 1e18),
            AssetToken.RecipientNotVerified.selector
        );
        vm.prank(alice);
        vm.expectRevert(AssetToken.RecipientNotVerified.selector);
        token.transfer(attacker, 1e18);

        assertEq(token.transferRestriction(alice, bob, 1e18), bytes4(0));
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    function testExpiredClaimBlocksTransfersButNotRedemption() public {
        identityRegistry.updateClaimExpiry(alice, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 2 days);
        assertFalse(identityRegistry.isVerified(alice));

        vm.prank(alice);
        vm.expectRevert(AssetToken.SenderNotVerified.selector);
        token.transfer(bob, 1e18);

        // Principal is never trapped by a stale KYC claim: the burn leg of a redemption passes.
        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        redemption.redeem(1_000e18, 0, RedemptionController.RedemptionMode.Normal);
        assertGt(musd.balanceOf(alice), before);
    }

    function testDeletedIdentityCannotReceive() public {
        identityRegistry.deleteIdentity(bob);
        vm.prank(alice);
        vm.expectRevert(AssetToken.RecipientNotVerified.selector);
        token.transfer(bob, 1e18);
    }

    function testRegistryAgentRoleIsEnforced() public {
        bytes32 agentRole = identityRegistry.REGISTRY_AGENT_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, agentRole
            )
        );
        vm.prank(attacker);
        identityRegistry.registerIdentity(attacker, attacker, COUNTRY_INDONESIA, CLASS_RETAIL, 0);
    }

    // ------------------------------------------------------------------
    // Pool inside the perimeter
    // ------------------------------------------------------------------

    function testVerifiedWalletCanTradeWithExemptPoolButPoolCannotPayUnverified() public {
        // Sell leg: verified holder -> pool.
        vm.prank(alice);
        token.transfer(address(pool), 500e18);
        assertEq(token.balanceOf(address(pool)), 500e18);

        // Buy leg: pool -> verified wallet passes without the pool being verified itself.
        assertFalse(identityRegistry.contains(address(pool)));
        vm.prank(address(pool));
        token.transfer(bob, 200e18);
        assertEq(token.balanceOf(bob), 200e18);

        // Pool -> unverified wallet is blocked: KYC is enforced at the pool boundary.
        vm.prank(address(pool));
        vm.expectRevert(AssetToken.RecipientNotVerified.selector);
        token.transfer(attacker, 1e18);
    }

    function testUnverifiedWalletCannotSellIntoPool() public {
        // An attacker cannot even hold tokens, but a wallet whose claim lapsed can: it may
        // still not sell into the pool.
        identityRegistry.updateClaimExpiry(alice, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2);
        vm.prank(alice);
        vm.expectRevert(AssetToken.SenderNotVerified.selector);
        token.transfer(address(pool), 1e18);
    }

    function testMarketManagerInventoryFundingRequiresVerifiedFunder() public {
        vm.prank(alice);
        token.approve(address(market), 100e18);
        vm.prank(alice);
        market.fundTokenInventory(100e18);
        assertEq(token.balanceOf(address(market)), 100e18);
    }

    // ------------------------------------------------------------------
    // Freeze and forced transfer
    // ------------------------------------------------------------------

    function testFrozenAddressCannotSendReceiveOrBuy() public {
        token.setAddressFrozen(alice, true);
        assertTrue(token.isFrozen(alice));

        vm.prank(alice);
        vm.expectRevert(AssetToken.SenderFrozen.selector);
        token.transfer(bob, 1e18);

        vm.prank(bob);
        vm.expectRevert(AssetToken.RecipientFrozen.selector);
        token.transfer(alice, 0);

        musd.faucet(alice, 10e6);
        vm.startPrank(alice);
        musd.approve(address(offering), 10e6);
        vm.expectRevert(AssetToken.RecipientFrozen.selector);
        offering.buy(10e6, 0);
        vm.stopPrank();

        token.setAddressFrozen(alice, false);
        vm.prank(alice);
        token.transfer(bob, 1e18);
    }

    function testPartialFreezeLimitsSpendableBalanceIncludingRedemption() public {
        token.freezePartialTokens(alice, 9_500e18);
        assertEq(token.getFrozenTokens(alice), 9_500e18);

        vm.prank(alice);
        vm.expectRevert(AssetToken.InsufficientUnfrozenBalance.selector);
        token.transfer(bob, 501e18);

        vm.prank(alice);
        vm.expectRevert(AssetToken.InsufficientUnfrozenBalance.selector);
        redemption.redeem(600e18, 0, RedemptionController.RedemptionMode.Normal);

        vm.prank(alice);
        token.transfer(bob, 500e18);

        vm.expectRevert(AssetToken.InvalidFreezeAmount.selector);
        token.freezePartialTokens(alice, 1);
        token.unfreezePartialTokens(alice, 9_500e18);
        assertEq(token.getFrozenTokens(alice), 0);
    }

    function testForcedTransferMovesFrozenTokensToVerifiedRecipientOnly() public {
        token.setAddressFrozen(alice, true);
        token.freezePartialTokens(alice, 10_000e18);

        vm.expectRevert(AssetToken.RecipientNotVerified.selector);
        token.forcedTransfer(alice, attacker, 1_000e18);

        token.forcedTransfer(alice, bob, 1_000e18);
        assertEq(token.balanceOf(bob), 1_000e18);
        assertEq(token.balanceOf(alice), 9_000e18);
        assertEq(token.getFrozenTokens(alice), 9_000e18);

        bytes32 agentRole = token.TRANSFER_AGENT_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, agentRole
            )
        );
        vm.prank(attacker);
        token.forcedTransfer(alice, bob, 1);
    }

    function testTransferRestrictionReportsPause() public {
        token.pause();
        assertEq(token.transferRestriction(alice, bob, 1), Pausable.EnforcedPause.selector);
        token.unpause();
        assertEq(token.transferRestriction(alice, bob, 1), bytes4(0));
    }

    // ------------------------------------------------------------------
    // Modular compliance
    // ------------------------------------------------------------------

    function testComplianceMustBeBoundBeforeItIsSet() public {
        compliance = new ModularCompliance(address(this));
        vm.expectRevert(AssetToken.ComplianceNotBound.selector);
        token.setCompliance(address(compliance));
        compliance.bindToken(address(token));
        token.setCompliance(address(compliance));
        assertEq(address(token.compliance()), address(compliance));
        token.setCompliance(address(0));
        assertEq(address(token.compliance()), address(0));
    }

    function testCountryModuleBlocksDisallowedJurisdictionButNotPoolOrBurn() public {
        _installCompliance();
        countryModule.setCountryAllowed(address(compliance), COUNTRY_INDONESIA, true);
        identityRegistry.updateCountry(bob, COUNTRY_SINGAPORE);

        assertEq(
            token.transferRestriction(alice, bob, 1e18), AssetToken.ComplianceCheckFailed.selector
        );
        vm.prank(alice);
        vm.expectRevert(AssetToken.ComplianceCheckFailed.selector);
        token.transfer(bob, 1e18);

        // Pool is exempt from the country rule, redemption burn is always allowed.
        vm.prank(alice);
        token.transfer(address(pool), 1e18);
        vm.prank(alice);
        redemption.redeem(1e18, 0, RedemptionController.RedemptionMode.Normal);

        countryModule.setCountryAllowed(address(compliance), COUNTRY_SINGAPORE, true);
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    function testTransferLockModuleEnforcesResaleHoldPeriodOnPrimaryIssuance() public {
        _installCompliance();
        countryModule.setCountryAllowed(address(compliance), COUNTRY_INDONESIA, true);
        lockModule.setHoldPeriod(address(compliance), 30 days);

        // Alice bought before the module was installed: unlocked. Bob buys now: locked.
        _buy(bob, 1_000e6);
        assertEq(lockModule.lockedUntil(address(compliance), bob), block.timestamp + 30 days);

        vm.prank(bob);
        vm.expectRevert(AssetToken.ComplianceCheckFailed.selector);
        token.transfer(alice, 1e18);
        vm.prank(bob);
        vm.expectRevert(AssetToken.ComplianceCheckFailed.selector);
        token.transfer(address(pool), 1e18);

        // Exit through the protected reserve is never blocked by the hold period.
        vm.prank(bob);
        redemption.redeem(100e18, 0, RedemptionController.RedemptionMode.Normal);

        vm.warp(block.timestamp + 30 days);
        vm.prank(bob);
        token.transfer(alice, 1e18);
    }

    function testComplianceHooksOnlyCallableByBoundToken() public {
        _installCompliance();
        vm.prank(attacker);
        vm.expectRevert(ModularCompliance.OnlyBoundToken.selector);
        compliance.transferred(alice, bob, 1);
    }

    // ------------------------------------------------------------------
    // ATS interoperability
    // ------------------------------------------------------------------

    function testRegistryServesAtsTokensAsExternalKycList() public {
        AtsExternalKycList list = new AtsExternalKycList(address(identityRegistry));
        assertEq(uint8(list.getKycStatus(alice)), uint8(AtsExternalKycList.KycStatus.GRANTED));
        assertEq(
            uint8(list.getKycStatus(attacker)), uint8(AtsExternalKycList.KycStatus.NOT_GRANTED)
        );
        identityRegistry.updateClaimExpiry(alice, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2);
        assertEq(uint8(list.getKycStatus(alice)), uint8(AtsExternalKycList.KycStatus.NOT_GRANTED));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _installCompliance() private {
        compliance = new ModularCompliance(address(this));
        countryModule = new CountryAllowModule(address(this));
        lockModule = new TransferLockModule(address(this));
        compliance.addModule(address(countryModule));
        compliance.addModule(address(lockModule));
        compliance.bindToken(address(token));
        token.setCompliance(address(compliance));
    }

    function _paramsFor(bytes32 id) private view returns (AssetFactory.DeploymentParams memory) {
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
}
