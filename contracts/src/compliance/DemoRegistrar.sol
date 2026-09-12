// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IdentityRegistry } from "./IdentityRegistry.sol";

/// @title  DemoRegistrar
/// @notice **DEMO STUB — anyone can self-verify on this testnet.** (D-034, under D-027 scope.)
///
/// @dev    SOLAR01 is a permissioned token: only wallets present in the protocol `IdentityRegistry`
///         may hold or receive it. That normally requires a KYC provider holding
///         `REGISTRY_AGENT_ROLE`. For the hackathon there is no provider, so a judge connecting a
///         fresh wallet could not touch the demo at all.
///
///         This contract stands in for the provider. It holds `REGISTRY_AGENT_ROLE` and exposes
///         exactly one state-changing function, which registers **the caller and nobody else**.
///
///         What this does and does not weaken:
///         - The *enforcement* is untouched and completely real. An unregistered wallet still
///           cannot hold, receive or buy SOLAR01; the compliance modules, freeze, forced transfer
///           and expiry machinery all behave exactly as in production.
///         - The *provider policy* is what becomes permissive: the gate is "anyone who calls this"
///           rather than "anyone a provider approved". That is what a testnet KYC stub is.
///         - The registry is protocol-wide, so this makes self-verification available for **every**
///           asset series sharing it on this chain, not only SOLAR01. Any surface describing this
///           deployment must say "anyone can self-verify on this testnet" rather than implying a
///           real gate.
///
///         Retail class is deliberate: judges land under the D-028 5,000 mUSD retail cap, so the
///         class system demonstrates itself rather than being described.
///
///         Winding down: revoking `REGISTRY_AGENT_ROLE` from this contract stops **further**
///         self-registration. It does not un-verify anyone already registered, and there is no bulk
///         undo — `deleteIdentity` is one wallet at a time. That is acceptable only because this
///         chain is disposable (D-027). It is not a kill switch and must not be described as one.
///         The production migration path is to revoke this contract and grant the role to a real
///         provider; no other contract references it, so it detaches cleanly.
contract DemoRegistrar {
    /// @notice Indonesia. Matches the jurisdiction allowed by the demo `CountryAllowModule`.
    uint16 public constant COUNTRY_INDONESIA = 360;
    /// @notice Retail (D-028 class 1), so the 5,000 mUSD subscription cap applies to judges.
    uint8 public constant CLASS_RETAIL = 1;

    /// @dev No claim expiry (D-034, amended): the hackathon deployment is disposable, so a
    ///      timeframe would bound a surface that is torn down anyway. Note the consequence — an
    ///      expiry is also what would have made revocation self-clearing.
    uint64 private constant NO_EXPIRY = 0;

    IdentityRegistry public immutable identityRegistry;

    event SelfRegistered(address indexed wallet, uint16 country, uint8 investorClass);

    error InvalidAddress();
    /// @dev D-027: testnets only. Checked per call rather than captured in the constructor, so a
    ///      chain fork cannot carry a stale "this is a testnet" answer forward.
    error UnsupportedChain(uint256 chainId);

    constructor(address identityRegistry_) {
        if (identityRegistry_ == address(0)) revert InvalidAddress();
        identityRegistry = IdentityRegistry(identityRegistry_);
    }

    /// @notice Register the caller as a verified Indonesian retail investor.
    /// @dev    `msg.sender` only. There is deliberately no arbitrary-address entry point: the agent
    ///         role this contract holds could otherwise be borrowed to verify a third party.
    ///
    ///         Idempotent. `registerIdentity` reverts `AlreadyRegistered` on a second call, so a
    ///         judge double-clicking would otherwise see a failed transaction; this returns quietly
    ///         instead. Returning also protects existing records — a wallet the owner registered as
    ///         accredited or institutional keeps its class if it ever calls this.
    ///
    ///         `msg.sender` may be a contract, and `onchainId` is then not meaningful. That is
    ///         accepted on purpose: a `tx.origin` or EOA check would lock out smart-account wallets,
    ///         which judges plausibly use, and it would buy nothing — this grants no authority
    ///         beyond holding a demo token.
    function selfRegister() external {
        _requireDemoChain();
        if (identityRegistry.contains(msg.sender)) return;
        identityRegistry.registerIdentity(
            msg.sender, msg.sender, COUNTRY_INDONESIA, CLASS_RETAIL, NO_EXPIRY
        );
        emit SelfRegistered(msg.sender, COUNTRY_INDONESIA, CLASS_RETAIL);
    }

    /// @notice Whether `wallet` would gain anything from calling `selfRegister`. False for an
    ///         already-registered wallet (the call is a no-op) and on an unsupported chain.
    /// @dev    A UI should use this to decide whether to show the button, not to decide whether the
    ///         wallet is verified — read `IdentityRegistry.isVerified` for that.
    function canSelfRegister(address wallet) external view returns (bool) {
        return _isDemoChain() && !identityRegistry.contains(wallet);
    }

    /// @notice Whether this contract still holds the agent role, i.e. whether the demo gate is open.
    function isActive() external view returns (bool) {
        return identityRegistry.hasRole(identityRegistry.REGISTRY_AGENT_ROLE(), address(this));
    }

    function _isDemoChain() private view returns (bool) {
        uint256 id = block.chainid;
        return id == 31_337 || id == 84_532 || id == 296;
    }

    function _requireDemoChain() private view {
        if (!_isDemoChain()) revert UnsupportedChain(block.chainid);
    }
}
