// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Pausable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IRevenueTransferHook } from "../interfaces/IRevenueTransferHook.sol";
import { IIdentityRegistry } from "../compliance/IIdentityRegistry.sol";
import { ICompliance } from "../compliance/ICompliance.sol";

/// @title AssetToken
/// @notice Capped, permissioned asset-participation token. Every transfer leg is checked against
///         the protocol identity registry unless the counterparty is registered infrastructure
///         (the canonical pool, the market manager). Modular compliance rules run on top.
///         Function names follow ERC-3643 so tooling built for T-REX / ATS can drive it.
contract AssetToken is ERC20, ERC20Permit, ERC20Pausable, AccessControl {
    bytes32 public constant ISSUANCE_CONTROLLER_ROLE = keccak256("ISSUANCE_CONTROLLER_ROLE");
    bytes32 public constant REDEMPTION_CONTROLLER_ROLE = keccak256("REDEMPTION_CONTROLLER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant TRANSFER_AGENT_ROLE = keccak256("TRANSFER_AGENT_ROLE");

    uint256 public immutable maximumSupply;
    bytes32 public immutable assetId;
    address public immutable registry;
    address public revenueDistributor;

    IIdentityRegistry public identityRegistry;
    ICompliance public compliance;
    /// @notice Running total of balances held by `_issuerAllocation` addresses. Maintained in
    ///         `_update` so `investorSupply()` never has to iterate holders.
    uint256 public issuerAllocationSupply;
    mapping(address => bool) private _complianceExempt;
    /// @notice Addresses holding the disclosed issuer/company allocation (D-024). Their balances
    ///         are excluded from `investorSupply` and they may never redeem against the reserve.
    mapping(address => bool) private _issuerAllocation;
    mapping(address => bool) private _frozen;
    mapping(address => uint256) private _frozenTokens;
    bool private _forcedTransferInProgress;

    event RevenueDistributorSet(address indexed distributor);
    event IdentityRegistryAdded(address indexed identityRegistry);
    event ComplianceAdded(address indexed compliance);
    event ComplianceExemptionChanged(address indexed account, bool exempt);
    event IssuerAllocationChanged(address indexed account, bool flagged, uint256 accountBalance);
    event AddressFrozen(address indexed userAddress, bool indexed isFrozen, address indexed owner);
    event TokensFrozen(address indexed userAddress, uint256 amount);
    event TokensUnfrozen(address indexed userAddress, uint256 amount);
    event ForcedTransfer(
        address indexed from, address indexed to, uint256 amount, address indexed agent
    );

    error MaximumSupplyExceeded();
    error InvalidAddress();
    error DistributorAlreadySet();
    error ComplianceNotBound();
    error InvalidFreezeAmount();
    // Transfer restrictions. `transferRestriction` returns the selector of the first one hit.
    error SenderNotVerified();
    error RecipientNotVerified();
    error SenderFrozen();
    error RecipientFrozen();
    error InsufficientUnfrozenBalance();
    error ComplianceCheckFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        address registry_,
        uint256 maximumSupply_,
        address admin
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (registry_ == address(0) || admin == address(0)) revert InvalidAddress();
        if (maximumSupply_ == 0) revert MaximumSupplyExceeded();
        assetId = assetId_;
        registry = registry_;
        maximumSupply = maximumSupply_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    function setRevenueDistributor(address distributor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (distributor == address(0)) revert InvalidAddress();
        if (revenueDistributor != address(0)) revert DistributorAlreadySet();
        revenueDistributor = distributor;
        emit RevenueDistributorSet(distributor);
    }

    /// @notice Bind the identity registry. Cannot be cleared: a permissioned token stays
    ///         permissioned. Swapping to another registry is allowed for migrations.
    function setIdentityRegistry(address identityRegistry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (identityRegistry_ == address(0)) revert InvalidAddress();
        identityRegistry = IIdentityRegistry(identityRegistry_);
        emit IdentityRegistryAdded(identityRegistry_);
    }

    /// @notice Bind a modular compliance contract that has already bound this token, or pass
    ///         zero to run with identity checks only.
    function setCompliance(address compliance_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (compliance_ != address(0) && !ICompliance(compliance_).isTokenBound(address(this))) {
            revert ComplianceNotBound();
        }
        compliance = ICompliance(compliance_);
        emit ComplianceAdded(compliance_);
    }

    /// @notice Infrastructure that is not an investor (canonical pool, market manager, vesting
    ///         wallet) bypasses identity and country checks for its own leg of a transfer. The
    ///         counterparty leg is still enforced, so a pool can only pay out to verified wallets.
    function setComplianceExempt(address account, bool exempt)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAddress();
        _complianceExempt[account] = exempt;
        emit ComplianceExemptionChanged(account, exempt);
    }

    /// @notice Flag or unflag an address as holding the disclosed issuer allocation (D-024).
    /// @dev    Adjusts `issuerAllocationSupply` by the account's current balance so the running
    ///         total stays correct when the flag is set on an address that already holds tokens.
    ///         This is a capital-structure designation, not a compliance control: flagged tokens
    ///         stay transferable to verified buyers, they simply cannot redeem and do not count
    ///         toward the backing denominator.
    function setIssuerAllocation(address account, bool flagged)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAddress();
        uint256 balance = balanceOf(account);
        if (_issuerAllocation[account] != flagged) {
            _issuerAllocation[account] = flagged;
            if (flagged) issuerAllocationSupply += balance;
            else issuerAllocationSupply -= balance;
        }
        emit IssuerAllocationChanged(account, flagged, balance);
    }

    // ---------------------------------------------------------------------
    // Supply
    // ---------------------------------------------------------------------

    function mint(address to, uint256 amount) external onlyRole(ISSUANCE_CONTROLLER_ROLE) {
        if (totalSupply() + amount > maximumSupply) revert MaximumSupplyExceeded();
        _mint(to, amount);
    }

    function burnForRedemption(address from, uint256 amount)
        external
        onlyRole(REDEMPTION_CONTROLLER_ROLE)
    {
        _burn(from, amount);
    }

    // ---------------------------------------------------------------------
    // Agent controls (ERC-3643 semantics)
    // ---------------------------------------------------------------------

    function setAddressFrozen(address userAddress, bool freeze)
        external
        onlyRole(TRANSFER_AGENT_ROLE)
    {
        _frozen[userAddress] = freeze;
        emit AddressFrozen(userAddress, freeze, msg.sender);
    }

    function freezePartialTokens(address userAddress, uint256 amount)
        external
        onlyRole(TRANSFER_AGENT_ROLE)
    {
        uint256 newFrozen = _frozenTokens[userAddress] + amount;
        if (amount == 0 || newFrozen > balanceOf(userAddress)) revert InvalidFreezeAmount();
        _frozenTokens[userAddress] = newFrozen;
        emit TokensFrozen(userAddress, amount);
    }

    function unfreezePartialTokens(address userAddress, uint256 amount)
        external
        onlyRole(TRANSFER_AGENT_ROLE)
    {
        if (amount == 0 || amount > _frozenTokens[userAddress]) {
            revert InvalidFreezeAmount();
        }
        _frozenTokens[userAddress] -= amount;
        emit TokensUnfrozen(userAddress, amount);
    }

    /// @notice Move tokens under a legal order or wallet recovery. Bypasses the sender's freeze,
    ///         verification, and compliance rules; the recipient must still be verified or exempt.
    function forcedTransfer(address from, address to, uint256 amount)
        external
        onlyRole(TRANSFER_AGENT_ROLE)
        returns (bool)
    {
        uint256 frozen = _frozenTokens[from];
        uint256 balance = balanceOf(from);
        uint256 free = balance > frozen ? balance - frozen : 0;
        if (amount > free) {
            uint256 toUnfreeze = amount - free;
            _frozenTokens[from] = frozen - toUnfreeze;
            emit TokensUnfrozen(from, toUnfreeze);
        }
        _forcedTransferInProgress = true;
        _transfer(from, to, amount);
        _forcedTransferInProgress = false;
        emit ForcedTransfer(from, to, amount, msg.sender);
        return true;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isComplianceExempt(address account) external view returns (bool) {
        return _complianceExempt[account];
    }

    function isIssuerAllocation(address account) external view returns (bool) {
        return _issuerAllocation[account];
    }

    /// @notice Supply held by investors: total supply minus the disclosed issuer allocation.
    ///         This is the denominator for backing, the reserve requirement and the redemption
    ///         price (D-024) - the issuer's own tokens must not draw on the investors' reserve.
    function investorSupply() public view returns (uint256) {
        return totalSupply() - issuerAllocationSupply;
    }

    function isFrozen(address userAddress) external view returns (bool) {
        return _frozen[userAddress];
    }

    function getFrozenTokens(address userAddress) external view returns (uint256) {
        return _frozenTokens[userAddress];
    }

    function isVerified(address account) public view returns (bool) {
        IIdentityRegistry registry_ = identityRegistry;
        return address(registry_) != address(0) && registry_.isVerified(account);
    }

    /// @notice Preview why a transfer would fail. Returns the custom-error selector of the first
    ///         violated rule, or `bytes4(0)` when the transfer is allowed. Balance and allowance
    ///         are not checked here.
    function transferRestriction(address from, address to, uint256 value)
        external
        view
        returns (bytes4)
    {
        // `burnForRedemption` is the only burn path and it is exempt from the protocol pause so
        // an authorized settlement cannot trap holders (see `_update`). Previewing a paused
        // redemption as blocked would contradict the contract, so only non-burn legs report the
        // pause here.
        if (paused() && to != address(0)) return Pausable.EnforcedPause.selector;
        return _transferRestriction(from, to, value);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _transferRestriction(address from, address to, uint256 value)
        private
        view
        returns (bytes4)
    {
        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        if (!isMint) {
            if (_frozen[from]) return SenderFrozen.selector;
            uint256 balance = balanceOf(from);
            uint256 frozen = _frozenTokens[from];
            uint256 free = balance > frozen ? balance - frozen : 0;
            if (value > free) return InsufficientUnfrozenBalance.selector;
        }
        if (!isBurn && _frozen[to]) return RecipientFrozen.selector;

        IIdentityRegistry registry_ = identityRegistry;
        if (address(registry_) != address(0)) {
            // A burn is a redemption exit; an expired claim must not trap a holder's principal.
            if (!isMint && !isBurn && !_complianceExempt[from] && !registry_.isVerified(from)) {
                return SenderNotVerified.selector;
            }
            if (!isBurn && !_complianceExempt[to] && !registry_.isVerified(to)) {
                return RecipientNotVerified.selector;
            }
        }

        ICompliance compliance_ = compliance;
        if (address(compliance_) != address(0) && !compliance_.canTransfer(from, to, value)) {
            return ComplianceCheckFailed.selector;
        }
        return bytes4(0);
    }

    function _revertWith(bytes4 selector) private pure {
        assembly {
            mstore(0, selector)
            revert(0, 4)
        }
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        if (_forcedTransferInProgress) {
            if (_frozen[to]) _revertWith(RecipientFrozen.selector);
            if (
                address(identityRegistry) != address(0) && !_complianceExempt[to]
                    && !identityRegistry.isVerified(to)
            ) _revertWith(RecipientNotVerified.selector);
        } else {
            bytes4 restriction = _transferRestriction(from, to, value);
            if (restriction != bytes4(0)) _revertWith(restriction);
        }

        address distributor = revenueDistributor;
        if (distributor != address(0) && from != to) {
            IRevenueTransferHook(distributor).onTokenTransfer(from, to, value);
        }
        // A protocol pause freezes transfers and issuance, but must not trap holders during an
        // authorized default/maturity settlement. Only the configured redemption controller can
        // use this burn-only escape hatch.
        if (paused() && to == address(0) && hasRole(REDEMPTION_CONTROLLER_ROLE, msg.sender)) {
            ERC20._update(from, to, value);
        } else {
            super._update(from, to, value);
        }

        // Keep the issuer-allocation running total in step with the balance change (D-024).
        // A mint into a flagged address adds, a burn out of one subtracts, and a transfer only
        // moves the total when it crosses the flagged/unflagged boundary.
        bool fromIssuerAllocation = from != address(0) && _issuerAllocation[from];
        bool toIssuerAllocation = to != address(0) && _issuerAllocation[to];
        if (fromIssuerAllocation && !toIssuerAllocation) {
            issuerAllocationSupply -= value;
        } else if (!fromIssuerAllocation && toIssuerAllocation) {
            issuerAllocationSupply += value;
        }

        ICompliance compliance_ = compliance;
        if (address(compliance_) != address(0)) {
            if (from == address(0)) compliance_.created(to, value);
            else if (to == address(0)) compliance_.destroyed(from, value);
            else compliance_.transferred(from, to, value);
        }
    }
}
