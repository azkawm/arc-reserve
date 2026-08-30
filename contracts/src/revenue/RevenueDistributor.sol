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

    uint16 public constant HOLDER_BPS = 6_000;
    uint16 public constant RESERVE_BPS = 2_500;
    uint16 public constant OPERATOR_BPS = 1_000;
    uint16 public constant PROTOCOL_BPS = 500;
    uint256 private constant ACCURACY = 1e30;

    IERC20 public immutable stablecoin;
    IAssetToken public immutable assetToken;
    IAssetVault public immutable vault;
    address public immutable operator;

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
        uint256 grossAmount,
        uint256 holderAmount,
        uint256 reserveAmount,
        uint256 operatorAmount,
        uint256 protocolAmount
    );
    event RevenueClaimed(address indexed holder, uint256 amount);
    event OperatorRevenueClaimed(address indexed operator, uint256 amount);
    event YieldExclusionChanged(address indexed account, bool excluded, uint256 accountBalance);

    error InvalidAddress();
    error InvalidSplits();
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
        if (HOLDER_BPS + RESERVE_BPS + OPERATOR_BPS + PROTOCOL_BPS != 10_000) {
            revert InvalidSplits();
        }
        stablecoin = IERC20(stablecoin_);
        assetToken = IAssetToken(assetToken_);
        vault = IAssetVault(vault_);
        operator = operator_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REVENUE_DEPOSITOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function depositRevenue(uint256 amount)
        external
        onlyRole(REVENUE_DEPOSITOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        uint256 supply = yieldEligibleSupply();
        if (supply == 0) revert NoYieldEligibleSupply();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        uint256 holderAmount = DecimalMath.applyBps(amount, HOLDER_BPS);
        uint256 reserveAmount = DecimalMath.applyBps(amount, RESERVE_BPS);
        uint256 operatorAmount = DecimalMath.applyBps(amount, OPERATOR_BPS);
        uint256 protocolAmount = amount - holderAmount - reserveAmount - operatorAmount;

        cumulativeRevenuePerToken += holderAmount * ACCURACY / supply;
        totalHolderRevenue += holderAmount;
        operatorAccrued += operatorAmount;

        stablecoin.safeTransfer(address(vault), reserveAmount + protocolAmount);
        vault.creditRevenueReserve(reserveAmount, protocolAmount);

        emit RevenueDeposited(
            msg.sender, amount, holderAmount, reserveAmount, operatorAmount, protocolAmount
        );
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
