// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAssetToken } from "../interfaces/IAssetToken.sol";
import { IAssetVault } from "../interfaces/IAssetVault.sol";
import { IRevenueTransferHook } from "../interfaces/IRevenueTransferHook.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";

contract RevenueDistributor is AccessControl, Pausable, ReentrancyGuard, IRevenueTransferHook {
    using SafeERC20 for IERC20;

    bytes32 public constant REVENUE_DEPOSITOR_ROLE = keccak256("REVENUE_DEPOSITOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Guard rails on any admin-set split (D-023). Holders cannot be squeezed out and the
    ///         operator/protocol shares cannot be inflated, whatever the schedule state.
    uint16 public constant MIN_HOLDER_BPS = 3_000;
    uint16 public constant MAX_OPERATOR_BPS = 1_500;
    uint16 public constant MAX_PROTOCOL_BPS = 1_000;
    uint256 private constant ACCURACY = 1e30;

    /// @notice How one revenue deposit is divided. Basis points, must total 10,000.
    struct RevenueSplit {
        uint16 holderBps;
        uint16 reserveBps;
        uint16 operatorBps;
        uint16 protocolBps;
    }

    IERC20 public immutable stablecoin;
    IAssetToken public immutable assetToken;
    IAssetVault public immutable vault;
    address public immutable operator;

    /// @notice Split applied while the reserve is on or ahead of the D-023 schedule.
    RevenueSplit public onScheduleSplit;
    /// @notice Split applied while backing is below schedule: holders take less so the sinking
    ///         fund catches up faster. Constrained to favour the reserve relative to the
    ///         on-schedule split - see `_validateSplits`.
    RevenueSplit public behindScheduleSplit;

    /// @notice Reporting cadence (D-022). Zero period disables the overdue view entirely.
    uint64 public reportingPeriodSeconds;
    uint64 public reportingGraceSeconds;
    uint64 public lastRevenueDepositAt;
    uint256 public lastPeriodId;
    mapping(uint256 => uint256) public revenueByPeriod;

    uint256 public cumulativeRevenuePerToken;
    uint256 public totalHolderRevenue;
    uint256 public totalClaimed;
    uint256 public operatorAccrued;
    uint256 public excludedSupply;
    mapping(address => bool) public yieldExcluded;
    mapping(address => uint256) private _rewardDebt;
    mapping(address => uint256) private _accrued;

    event RevenueDeposited(
        address indexed depositor,
        uint256 indexed periodId,
        bytes32 reportHash,
        bool behindSchedule,
        uint256 grossAmount,
        uint256 holderAmount,
        uint256 reserveAmount,
        uint256 operatorAmount,
        uint256 protocolAmount
    );
    event RevenueSplitsSet(RevenueSplit onSchedule, RevenueSplit behindSchedule);
    event ReportingPolicySet(uint64 periodSeconds, uint64 graceSeconds);
    event RevenueClaimed(address indexed holder, uint256 amount);
    event OperatorRevenueClaimed(address indexed operator, uint256 amount);
    event YieldExclusionChanged(address indexed account, bool excluded, uint256 accountBalance);

    error InvalidAddress();
    error InvalidSplits();
    error InvalidReportingPolicy();
    error NoYieldEligibleSupply();
    error NoRevenueToClaim();
    error UnauthorizedHook();
    error UnauthorizedOperator();

    constructor(
        address stablecoin_,
        address assetToken_,
        address vault_,
        address operator_,
        address admin
    ) {
        if (
            stablecoin_ == address(0) || assetToken_ == address(0) || vault_ == address(0)
                || operator_ == address(0) || admin == address(0)
        ) revert InvalidAddress();
        // Defaults: 60/25/10/5 on schedule, shifting to 40/45/10/5 while behind (D-023).
        RevenueSplit memory onSchedule = RevenueSplit(6_000, 2_500, 1_000, 500);
        RevenueSplit memory behind = RevenueSplit(4_000, 4_500, 1_000, 500);
        _validateSplits(onSchedule, behind);
        onScheduleSplit = onSchedule;
        behindScheduleSplit = behind;
        emit RevenueSplitsSet(onSchedule, behind);
        stablecoin = IERC20(stablecoin_);
        assetToken = IAssetToken(assetToken_);
        vault = IAssetVault(vault_);
        operator = operator_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REVENUE_DEPOSITOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Deposit the contracted share of gross asset revenue for one reporting period.
    /// @param  amount     mUSD to distribute.
    /// @param  periodId   The reporting period this settles (D-022). Recorded, not validated -
    ///                    the verifier reconciles it against the term sheet offchain.
    /// @param  reportHash Hash of the revenue report backing this deposit.
    /// @dev    The split depends on whether the reserve is behind the D-023 schedule at this
    ///         moment: holders take less so the sinking fund catches up faster. Evaluated live
    ///         rather than stored so it cannot go stale.
    function depositRevenue(uint256 amount, uint256 periodId, bytes32 reportHash)
        external
        onlyRole(REVENUE_DEPOSITOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        uint256 supply = yieldEligibleSupply();
        if (supply == 0) revert NoYieldEligibleSupply();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        bool behind = vault.isBehindSchedule();
        RevenueSplit memory split = behind ? behindScheduleSplit : onScheduleSplit;

        uint256 holderAmount = DecimalMath.applyBps(amount, split.holderBps);
        uint256 reserveAmount = DecimalMath.applyBps(amount, split.reserveBps);
        uint256 operatorAmount = DecimalMath.applyBps(amount, split.operatorBps);
        uint256 protocolAmount = amount - holderAmount - reserveAmount - operatorAmount;

        cumulativeRevenuePerToken += holderAmount * ACCURACY / supply;
        totalHolderRevenue += holderAmount;
        operatorAccrued += operatorAmount;

        lastRevenueDepositAt = uint64(block.timestamp);
        lastPeriodId = periodId;
        revenueByPeriod[periodId] += amount;

        stablecoin.safeTransfer(address(vault), reserveAmount + protocolAmount);
        vault.creditRevenueReserve(reserveAmount, protocolAmount);

        emit RevenueDeposited(
            msg.sender,
            periodId,
            reportHash,
            behind,
            amount,
            holderAmount,
            reserveAmount,
            operatorAmount,
            protocolAmount
        );
    }

    /// @notice Replace both split variants. Bounded by `MIN_HOLDER_BPS`, `MAX_OPERATOR_BPS` and
    ///         `MAX_PROTOCOL_BPS`, and the behind-schedule variant must favour the reserve at
    ///         least as much as the on-schedule one.
    function setRevenueSplits(RevenueSplit calldata onSchedule, RevenueSplit calldata behind)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _validateSplits(onSchedule, behind);
        onScheduleSplit = onSchedule;
        behindScheduleSplit = behind;
        emit RevenueSplitsSet(onSchedule, behind);
    }

    /// @notice Set the expected reporting cadence (D-022). A zero period disables
    ///         `isReportingOverdue` entirely rather than reporting everything as late.
    function setReportingPolicy(uint64 periodSeconds, uint64 graceSeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (periodSeconds == 0 && graceSeconds != 0) revert InvalidReportingPolicy();
        reportingPeriodSeconds = periodSeconds;
        reportingGraceSeconds = graceSeconds;
        // Start the clock from configuration so a freshly configured asset is not instantly late.
        if (lastRevenueDepositAt == 0) lastRevenueDepositAt = uint64(block.timestamp);
        emit ReportingPolicySet(periodSeconds, graceSeconds);
    }

    /// @notice The split that a deposit would use right now.
    function activeSplit() external view returns (RevenueSplit memory split, bool behind) {
        behind = vault.isBehindSchedule();
        split = behind ? behindScheduleSplit : onScheduleSplit;
    }

    /// @notice When the next revenue report is due, or 0 when no cadence is configured.
    function reportingDueAt() public view returns (uint64) {
        if (reportingPeriodSeconds == 0) return 0;
        return lastRevenueDepositAt + reportingPeriodSeconds;
    }

    /// @notice True when a reporting period has been missed past its grace window (D-022). This is
    ///         surfaced to the verifier and UI; it does not itself gate anything onchain.
    function isReportingOverdue() public view returns (bool) {
        uint64 dueAt = reportingDueAt();
        if (dueAt == 0) return false;
        return block.timestamp > uint256(dueAt) + reportingGraceSeconds;
    }

    function _validateSplits(RevenueSplit memory onSchedule, RevenueSplit memory behind)
        private
        pure
    {
        _validateSplit(onSchedule);
        _validateSplit(behind);
        // The behind-schedule variant exists to refill the reserve. It may never route less to the
        // reserve, or more to holders, than the on-schedule split.
        if (behind.reserveBps < onSchedule.reserveBps || behind.holderBps > onSchedule.holderBps) {
            revert InvalidSplits();
        }
    }

    function _validateSplit(RevenueSplit memory split) private pure {
        if (
            uint256(split.holderBps) + split.reserveBps + split.operatorBps + split.protocolBps
                != 10_000
        ) revert InvalidSplits();
        if (split.holderBps < MIN_HOLDER_BPS) revert InvalidSplits();
        if (split.operatorBps > MAX_OPERATOR_BPS) revert InvalidSplits();
        if (split.protocolBps > MAX_PROTOCOL_BPS) revert InvalidSplits();
    }

    function onTokenTransfer(address from, address to, uint256 amount) external {
        if (msg.sender != address(assetToken)) revert UnauthorizedHook();
        if (from == to) return;

        bool fromExcluded = from != address(0) && yieldExcluded[from];
        bool toExcluded = to != address(0) && yieldExcluded[to];

        if (from != address(0)) {
            uint256 fromBalance = assetToken.balanceOf(from);
            _accrue(from, fromBalance);
            _rewardDebt[from] =
                fromExcluded ? 0 : (fromBalance - amount) * cumulativeRevenuePerToken / ACCURACY;
        }
        if (to != address(0)) {
            uint256 toBalance = assetToken.balanceOf(to);
            _accrue(to, toBalance);
            _rewardDebt[to] =
                toExcluded ? 0 : (toBalance + amount) * cumulativeRevenuePerToken / ACCURACY;
        }

        if (fromExcluded && !toExcluded) {
            excludedSupply -= amount;
        } else if (!fromExcluded && toExcluded) {
            excludedSupply += amount;
        }
    }

    function setYieldExcluded(address account, bool excluded)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAddress();
        if (yieldExcluded[account] == excluded) return;

        uint256 balance = assetToken.balanceOf(account);
        if (excluded) {
            _accrue(account, balance);
            yieldExcluded[account] = true;
            excludedSupply += balance;
            _rewardDebt[account] = 0;
        } else {
            yieldExcluded[account] = false;
            excludedSupply -= balance;
            _rewardDebt[account] = balance * cumulativeRevenuePerToken / ACCURACY;
        }

        emit YieldExclusionChanged(account, excluded, balance);
    }

    /// @notice Supply that earns revenue: total supply minus yield-excluded balances (D-006).
    /// @dev    Named for what it is. This is NOT circulating supply and NOT `investorSupply`
    ///         (D-024) - a released company token can be investor supply while still excluded
    ///         from yield, and the three denominators must not be used interchangeably.
    function yieldEligibleSupply() public view returns (uint256) {
        return assetToken.totalSupply() - excludedSupply;
    }

    /// @notice Deprecated alias for `yieldEligibleSupply`. Kept so existing consumers keep
    ///         building; prefer the explicit name.
    function circulatingSupply() external view returns (uint256) {
        return yieldEligibleSupply();
    }

    function yieldEligibleBalanceOf(address holder) public view returns (uint256) {
        return yieldExcluded[holder] ? 0 : assetToken.balanceOf(holder);
    }

    function claimableRevenue(address holder) public view returns (uint256) {
        uint256 accumulated = yieldEligibleBalanceOf(holder) * cumulativeRevenuePerToken / ACCURACY;
        uint256 pending = accumulated > _rewardDebt[holder] ? accumulated - _rewardDebt[holder] : 0;
        return _accrued[holder] + pending;
    }

    function claimRevenue() external nonReentrant whenNotPaused returns (uint256 amount) {
        _accrue(msg.sender, yieldEligibleBalanceOf(msg.sender));
        amount = _accrued[msg.sender];
        if (amount == 0) revert NoRevenueToClaim();
        _accrued[msg.sender] = 0;
        totalClaimed += amount;
        stablecoin.safeTransfer(msg.sender, amount);
        emit RevenueClaimed(msg.sender, amount);
    }

    function claimOperatorRevenue() external nonReentrant returns (uint256 amount) {
        if (msg.sender != operator) revert UnauthorizedOperator();
        amount = operatorAccrued;
        if (amount == 0) revert NoRevenueToClaim();
        operatorAccrued = 0;
        stablecoin.safeTransfer(operator, amount);
        emit OperatorRevenueClaimed(operator, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _accrue(address holder, uint256 balance) private {
        if (yieldExcluded[holder]) {
            _rewardDebt[holder] = 0;
            return;
        }
        uint256 accumulated = balance * cumulativeRevenuePerToken / ACCURACY;
        uint256 debt = _rewardDebt[holder];
        if (accumulated > debt) _accrued[holder] += accumulated - debt;
        _rewardDebt[holder] = accumulated;
    }
}
