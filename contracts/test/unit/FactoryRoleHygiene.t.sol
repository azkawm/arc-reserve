// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";

/// @notice The factory is constructed as admin of every component so it can wire them, then hands
///         administration to the protocol admin. It must not keep anything afterwards: a deployer
///         with a standing pauser or keeper role on every series it ever created is a privilege
///         with no purpose and a large blast radius.
contract FactoryRoleHygieneTest is ArcReserveTestBase {
    function _assertFactoryHasNoRole(address component, bytes32 role, string memory label)
        internal
        view
    {
        (bool ok, bytes memory data) = component.staticcall(
            abi.encodeWithSignature("hasRole(bytes32,address)", role, address(factory))
        );
        assertTrue(ok, "hasRole call failed");
        assertFalse(abi.decode(data, (bool)), label);
    }

    function test_factoryKeepsNoRolesOnTheToken() public view {
        _assertFactoryHasNoRole(address(token), token.DEFAULT_ADMIN_ROLE(), "token admin");
        _assertFactoryHasNoRole(address(token), token.PAUSER_ROLE(), "token pauser");
        _assertFactoryHasNoRole(address(token), token.TRANSFER_AGENT_ROLE(), "token agent");
        _assertFactoryHasNoRole(address(token), token.ISSUANCE_CONTROLLER_ROLE(), "token issuance");
        _assertFactoryHasNoRole(
            address(token), token.REDEMPTION_CONTROLLER_ROLE(), "token redemption"
        );
    }

    function test_factoryKeepsNoRolesOnTheVault() public view {
        _assertFactoryHasNoRole(address(vault), vault.DEFAULT_ADMIN_ROLE(), "vault admin");
        _assertFactoryHasNoRole(address(vault), vault.PAUSER_ROLE(), "vault pauser");
        _assertFactoryHasNoRole(address(vault), vault.ALLOCATOR_ROLE(), "vault allocator");
        _assertFactoryHasNoRole(
            address(vault), vault.REDEMPTION_CONTROLLER_ROLE(), "vault redemption"
        );
        _assertFactoryHasNoRole(address(vault), vault.MARKET_MANAGER_ROLE(), "vault market");
        _assertFactoryHasNoRole(address(vault), vault.REVENUE_DEPOSITOR_ROLE(), "vault depositor");
        _assertFactoryHasNoRole(address(vault), vault.YIELD_SOURCE_ROLE(), "vault yield source");
    }

    function test_factoryKeepsNoRolesOnTheOffering() public view {
        _assertFactoryHasNoRole(address(offering), offering.DEFAULT_ADMIN_ROLE(), "offering admin");
        _assertFactoryHasNoRole(address(offering), offering.PAUSER_ROLE(), "offering pauser");
    }

    function test_factoryKeepsNoRolesOnTheDistributor() public view {
        _assertFactoryHasNoRole(address(revenue), revenue.DEFAULT_ADMIN_ROLE(), "revenue admin");
        _assertFactoryHasNoRole(address(revenue), revenue.PAUSER_ROLE(), "revenue pauser");
        _assertFactoryHasNoRole(
            address(revenue), revenue.REVENUE_DEPOSITOR_ROLE(), "revenue depositor"
        );
    }

    function test_factoryKeepsNoRolesOnTheRedemptionController() public view {
        _assertFactoryHasNoRole(
            address(redemption), redemption.DEFAULT_ADMIN_ROLE(), "redemption admin"
        );
        _assertFactoryHasNoRole(address(redemption), redemption.PAUSER_ROLE(), "redemption pauser");
        _assertFactoryHasNoRole(address(redemption), redemption.KEEPER_ROLE(), "redemption keeper");
    }

    function test_factoryKeepsNoRolesOnTheMarketManager() public view {
        _assertFactoryHasNoRole(address(market), market.DEFAULT_ADMIN_ROLE(), "market admin");
        _assertFactoryHasNoRole(address(market), market.PAUSER_ROLE(), "market pauser");
        _assertFactoryHasNoRole(address(market), market.KEEPER_ROLE(), "market keeper");
    }

    /// @dev The counterpart: renouncing must not strand a capability. Every role the factory gave
    ///      up has a live holder.
    function test_everyOperationalRoleStillHasAHolder() public view {
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(token.hasRole(token.PAUSER_ROLE(), address(this)));
        assertTrue(token.hasRole(token.ISSUANCE_CONTROLLER_ROLE(), address(offering)));
        assertTrue(token.hasRole(token.REDEMPTION_CONTROLLER_ROLE(), address(redemption)));
        assertTrue(vault.hasRole(vault.ALLOCATOR_ROLE(), address(offering)));
        assertTrue(vault.hasRole(vault.ALLOCATOR_ROLE(), address(revenue)));
        assertTrue(vault.hasRole(vault.MARKET_MANAGER_ROLE(), address(market)));
        assertTrue(vault.hasRole(vault.REVENUE_DEPOSITOR_ROLE(), address(this)));
        assertTrue(revenue.hasRole(revenue.REVENUE_DEPOSITOR_ROLE(), address(this)));
        assertTrue(redemption.hasRole(redemption.KEEPER_ROLE(), address(this)));
        assertTrue(market.hasRole(market.KEEPER_ROLE(), address(this)));
    }
}
