// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IdentityRegistry } from "../../src/compliance/IdentityRegistry.sol";
import { DemoRegistrar } from "../../src/compliance/DemoRegistrar.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @dev A smart-account stand-in. Judges may connect one, so a contract caller must work.
contract ContractWallet {
    function register(DemoRegistrar registrar) external {
        registrar.selfRegister();
    }
}

/// @notice D-034: the permissionless KYC stub. These tests pin what it may and may not do — the
///         "may not" half matters more, because it holds a role that can verify any wallet.
contract DemoRegistrarTest is Test {
    uint16 internal constant COUNTRY_INDONESIA = 360;
    uint8 internal constant CLASS_RETAIL = 1;
    uint8 internal constant CLASS_INSTITUTIONAL = 3;

    IdentityRegistry internal registry;
    DemoRegistrar internal registrar;

    address internal judge = makeAddr("judge");
    address internal otherJudge = makeAddr("otherJudge");
    address internal owner = makeAddr("owner");

    function setUp() public {
        registry = new IdentityRegistry(address(this));
        registrar = new DemoRegistrar(address(registry));
        registry.grantRole(registry.REGISTRY_AGENT_ROLE(), address(registrar));
    }

    // -----------------------------------------------------------------
    // The happy path
    // -----------------------------------------------------------------

    function test_selfRegisterVerifiesTheCallerAsIndonesianRetail() public {
        assertFalse(registry.isVerified(judge));

        vm.expectEmit(true, false, false, true, address(registrar));
        emit DemoRegistrar.SelfRegistered(judge, COUNTRY_INDONESIA, CLASS_RETAIL);
        vm.prank(judge);
        registrar.selfRegister();

        assertTrue(registry.isVerified(judge));
        assertTrue(registry.contains(judge));
        assertEq(registry.investorCountry(judge), COUNTRY_INDONESIA);
        assertEq(registry.investorClass(judge), CLASS_RETAIL);
        assertEq(registry.identity(judge), judge);
    }

    /// @dev Retail is deliberate: it puts judges under the D-028 5,000 mUSD cap so the class system
    ///      demonstrates itself instead of being described.
    function test_judgesLandInTheCappedRetailClass() public {
        vm.prank(judge);
        registrar.selfRegister();
        assertEq(registry.investorClass(judge), CLASS_RETAIL);
    }

    /// @dev No expiry (D-034 as amended): verification does not lapse.
    function test_registrationDoesNotExpire() public {
        vm.prank(judge);
        registrar.selfRegister();
        assertEq(registry.claimExpiresAt(judge), 0);

        vm.warp(block.timestamp + 3650 days);
        assertTrue(registry.isVerified(judge), "no expiry means still verified");
    }

    function test_aContractWalletCanRegisterItself() public {
        ContractWallet wallet = new ContractWallet();
        wallet.register(registrar);
        assertTrue(registry.isVerified(address(wallet)));
    }

    // -----------------------------------------------------------------
    // Idempotency
    // -----------------------------------------------------------------

    /// @dev registerIdentity reverts AlreadyRegistered on a second call, so without the early
    ///      return a judge double-clicking would see a failed transaction.
    function test_callingTwiceIsANoOpRatherThanARevert() public {
        vm.prank(judge);
        registrar.selfRegister();
        uint256 countAfterFirst = registry.identityCount();

        vm.prank(judge);
        registrar.selfRegister();

        assertEq(registry.identityCount(), countAfterFirst, "second call must not add a record");
        assertTrue(registry.isVerified(judge));
    }

    /// @dev The early return also protects existing records. A wallet the owner classified as
    ///      institutional must not silently demote itself to retail - and inherit the 5,000 cap -
    ///      by pressing the demo button.
    function test_anExistingClassificationIsNeverOverwritten() public {
        registry.registerIdentity(owner, owner, COUNTRY_INDONESIA, CLASS_INSTITUTIONAL, 0);

        vm.prank(owner);
        registrar.selfRegister();

        assertEq(registry.investorClass(owner), CLASS_INSTITUTIONAL, "class must survive");
    }

    /// @dev deleteIdentity clears the `registered` flag, so a removed wallet can come back.
    function test_aDeletedWalletCanRegisterAgain() public {
        vm.prank(judge);
        registrar.selfRegister();
        registry.deleteIdentity(judge);
        assertFalse(registry.isVerified(judge));

        vm.prank(judge);
        registrar.selfRegister();
        assertTrue(registry.isVerified(judge));
    }

    // -----------------------------------------------------------------
    // What it must NOT be able to do
    // -----------------------------------------------------------------

    /// @dev The core containment property: the agent role cannot be borrowed to verify a third
    ///      party. Registering `judge` must leave every other wallet untouched.
    function test_registeringOneWalletVerifiesNobodyElse() public {
        vm.prank(judge);
        registrar.selfRegister();

        assertTrue(registry.isVerified(judge));
        assertFalse(registry.isVerified(otherJudge));
        assertFalse(registry.contains(otherJudge));
        assertEq(registry.identityCount(), 1);
    }

    function test_theRegistrarExposesNoArbitraryAddressEntryPoint() public view {
        // If an arbitrary-address path is ever added, this fails and forces a decision.
        // `selfRegister()`, the two views and the constants are the whole mutable/queryable surface.
        assertEq(
            registrar.selfRegister.selector,
            bytes4(keccak256("selfRegister()")),
            "selfRegister must take no arguments"
        );
    }

    // -----------------------------------------------------------------
    // Chain guard (D-027)
    // -----------------------------------------------------------------

    function test_worksOnEachSupportedTestnet() public {
        uint256[3] memory chains = [uint256(31_337), 84_532, 296];
        for (uint256 i = 0; i < chains.length; i++) {
            IdentityRegistry freshRegistry = new IdentityRegistry(address(this));
            DemoRegistrar fresh = new DemoRegistrar(address(freshRegistry));
            freshRegistry.grantRole(freshRegistry.REGISTRY_AGENT_ROLE(), address(fresh));

            vm.chainId(chains[i]);
            vm.prank(judge);
            fresh.selfRegister();
            assertTrue(freshRegistry.isVerified(judge));
        }
    }

    function test_refusesToRunOnMainnet() public {
        vm.chainId(1);
        vm.prank(judge);
        vm.expectRevert(abi.encodeWithSelector(DemoRegistrar.UnsupportedChain.selector, uint256(1)));
        registrar.selfRegister();
        assertFalse(registry.isVerified(judge));
    }

    function test_refusesOnBaseMainnet() public {
        vm.chainId(8453);
        vm.prank(judge);
        vm.expectRevert(
            abi.encodeWithSelector(DemoRegistrar.UnsupportedChain.selector, uint256(8453))
        );
        registrar.selfRegister();
    }

    // -----------------------------------------------------------------
    // Role dependency and winding down
    // -----------------------------------------------------------------

    function test_withoutTheAgentRoleItCannotRegisterAnyone() public {
        DemoRegistrar ungranted = new DemoRegistrar(address(registry));
        bytes32 agentRole = registry.REGISTRY_AGENT_ROLE();

        vm.prank(judge);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(ungranted),
                agentRole
            )
        );
        ungranted.selfRegister();
    }

    /// @dev Revoking the role stops FURTHER self-registration. It deliberately does not un-verify
    ///      anyone already registered - there is no expiry and no bulk undo, which is why this is
    ///      acceptable only for a disposable chain (D-027) and must not be called a kill switch.
    function test_revokingTheRoleStopsNewSignupsButUnverifiesNobody() public {
        vm.prank(judge);
        registrar.selfRegister();
        assertTrue(registrar.isActive());

        registry.revokeRole(registry.REGISTRY_AGENT_ROLE(), address(registrar));
        assertFalse(registrar.isActive());

        vm.prank(otherJudge);
        vm.expectRevert();
        registrar.selfRegister();
        assertFalse(registry.isVerified(otherJudge));

        // The already-registered judge is untouched: stopping the bleeding, not a rollback.
        assertTrue(registry.isVerified(judge), "existing registrations survive revocation");
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    function test_canSelfRegisterReflectsWhatTheCallWouldDo() public {
        assertTrue(registrar.canSelfRegister(judge));
        vm.prank(judge);
        registrar.selfRegister();
        assertFalse(registrar.canSelfRegister(judge), "already registered: the call is a no-op");
    }

    function test_canSelfRegisterIsFalseOnAnUnsupportedChain() public {
        vm.chainId(1);
        assertFalse(registrar.canSelfRegister(judge));
    }

    function test_constructorRejectsTheZeroAddress() public {
        vm.expectRevert(DemoRegistrar.InvalidAddress.selector);
        new DemoRegistrar(address(0));
    }
}
