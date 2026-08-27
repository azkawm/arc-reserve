// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IAssetToken } from "../interfaces/IAssetToken.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";

contract AssetVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");
    bytes32 public constant REDEMPTION_CONTROLLER_ROLE = keccak256("REDEMPTION_CONTROLLER_ROLE");
    bytes32 public constant MARKET_MANAGER_ROLE = keccak256("MARKET_MANAGER_ROLE");
    bytes32 public constant REVENUE_DEPOSITOR_ROLE = keccak256("REVENUE_DEPOSITOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable stablecoin;
    IAssetToken public immutable assetToken;
    IAssetRegistry public immutable registry;
    bytes32 public immutable assetId;
    address public immutable issuer;
    uint16 public immutable minimumReserveRatioBps;

    uint256 public redemptionReserve;
    uint256 public marketMakingAllocation;
    uint256 public assetRevenue;
    uint256 public issuerProceeds;
    uint256 public protocolFees;

    event AllocationChanged(
        bytes32 indexed category, int256 delta, uint256 newCategoryBalance, uint256 totalAccounted
    );
    event InitialReserveDeposited(address indexed issuer, uint256 amount);
    event IssuerProceedsWithdrawn(address indexed issuer, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);
    event RedemptionReleased(address indexed recipient, uint256 amount);
    event MarketFundsReleased(address indexed marketManager, uint256 amount);
    event MarketFundsReturned(address indexed marketManager, uint256 amount);

    error InvalidAddress();
    error InvalidRatio();
    error UnauthorizedIssuer();
    error InsufficientUnaccountedBalance();
    error InsufficientCategoryBalance();
    error ReserveRequirementViolated();
    error AccountingInsolvent();

    constructor(
        address stablecoin_,
        address assetToken_,
        address registry_,
        bytes32 assetId_,
        address issuer_,
        uint16 minimumReserveRatioBps_,
        address admin
    ) {
        if (
            stablecoin_ == address(0) || assetToken_ == address(0) || registry_ == address(0)
                || issuer_ == address(0) || admin == address(0)
        ) revert InvalidAddress();
        if (minimumReserveRatioBps_ == 0 || minimumReserveRatioBps_ > 10_000) {
            revert InvalidRatio();
        }
        stablecoin = IERC20(stablecoin_);
        assetToken = IAssetToken(assetToken_);
        registry = IAssetRegistry(registry_);
        assetId = assetId_;
        issuer = issuer_;
        minimumReserveRatioBps = minimumReserveRatioBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function depositInitialReserve(uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        redemptionReserve += amount;
        _emitAllocation("REDEMPTION_RESERVE", int256(amount), redemptionReserve);
        emit InitialReserveDeposited(msg.sender, amount);
    }

    /// @notice Called only after the offering has transferred the exact proceeds into this vault.
    function recordPrimaryProceeds(
        uint256 issuerAmount,
        uint256 reserveAmount,
        uint256 marketAmount
    ) external onlyRole(ALLOCATOR_ROLE) whenNotPaused {
        uint256 total = issuerAmount + reserveAmount + marketAmount;
        _requireUnaccounted(total);
        issuerProceeds += issuerAmount;
        redemptionReserve += reserveAmount;
        marketMakingAllocation += marketAmount;
        _emitAllocation("ISSUER_PROCEEDS", int256(issuerAmount), issuerProceeds);
        _emitAllocation("REDEMPTION_RESERVE", int256(reserveAmount), redemptionReserve);
        _emitAllocation("MARKET_ALLOCATION", int256(marketAmount), marketMakingAllocation);
    }

    /// @notice Called after the distributor sends the reserve and protocol shares to this vault.
    function creditRevenueReserve(uint256 reserveAmount, uint256 protocolAmount)
        external
        onlyRole(ALLOCATOR_ROLE)
        whenNotPaused
    {
        _requireUnaccounted(reserveAmount + protocolAmount);
        redemptionReserve += reserveAmount;
        protocolFees += protocolAmount;
        _emitAllocation("REDEMPTION_RESERVE", int256(reserveAmount), redemptionReserve);
        _emitAllocation("PROTOCOL_FEES", int256(protocolAmount), protocolFees);
    }

    function depositAssetRevenue(uint256 amount)
        external
        onlyRole(REVENUE_DEPOSITOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        assetRevenue += amount;
        _emitAllocation("ASSET_REVENUE", int256(amount), assetRevenue);
    }

    function allocateAssetRevenueToReserve(uint256 amount) external onlyRole(ALLOCATOR_ROLE) {
        if (amount > assetRevenue) revert InsufficientCategoryBalance();
        assetRevenue -= amount;
        redemptionReserve += amount;
        _emitAllocation("ASSET_REVENUE", -int256(amount), assetRevenue);
        _emitAllocation("REDEMPTION_RESERVE", int256(amount), redemptionReserve);
    }

    function releaseRedemption(address recipient, uint256 amount)
        external
        onlyRole(REDEMPTION_CONTROLLER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (amount > redemptionReserve) revert InsufficientCategoryBalance();
        redemptionReserve -= amount;
        stablecoin.safeTransfer(recipient, amount);
        _emitAllocation("REDEMPTION_RESERVE", -int256(amount), redemptionReserve);
        emit RedemptionReleased(recipient, amount);
        _assertAccounting();
    }

    function withdrawMarketAllocation(uint256 amount)
        external
        onlyRole(MARKET_MANAGER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (amount > marketMakingAllocation) {
            revert InsufficientCategoryBalance();
        }
        if (redemptionReserve < minimumRequiredReserve()) revert ReserveRequirementViolated();
        marketMakingAllocation -= amount;
        stablecoin.safeTransfer(msg.sender, amount);
        _emitAllocation("MARKET_ALLOCATION", -int256(amount), marketMakingAllocation);
        emit MarketFundsReleased(msg.sender, amount);
        _assertAccounting();
    }

    function returnMarketAllocation(uint256 amount)
        external
        onlyRole(MARKET_MANAGER_ROLE)
        nonReentrant
    {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        marketMakingAllocation += amount;
        _emitAllocation("MARKET_ALLOCATION", int256(amount), marketMakingAllocation);
        emit MarketFundsReturned(msg.sender, amount);
    }

    function withdrawIssuerProceeds(uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        if (amount > issuerProceeds) revert InsufficientCategoryBalance();
        issuerProceeds -= amount;
        stablecoin.safeTransfer(issuer, amount);
        _emitAllocation("ISSUER_PROCEEDS", -int256(amount), issuerProceeds);
        emit IssuerProceedsWithdrawn(issuer, amount);
        _assertAccounting();
    }

    function withdrawProtocolFees(address recipient, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount > protocolFees) revert InsufficientCategoryBalance();
        protocolFees -= amount;
        stablecoin.safeTransfer(recipient, amount);
        _emitAllocation("PROTOCOL_FEES", -int256(amount), protocolFees);
        emit ProtocolFeesWithdrawn(recipient, amount);
        _assertAccounting();
    }

    function totalStablecoinBalance() public view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    function totalAccounted() public view returns (uint256) {
        return
            redemptionReserve + marketMakingAllocation + assetRevenue + issuerProceeds
                + protocolFees;
    }

    function minimumRequiredReserve() public view returns (uint256) {
        (uint256 nav,) = registry.navOf(assetId);
        uint256 obligationsAtNAV = DecimalMath.assetToStable(assetToken.totalSupply(), nav);
        return DecimalMath.applyBps(obligationsAtNAV, minimumReserveRatioBps);
    }

    function reserveRatioBps() public view returns (uint256) {
        (uint256 nav,) = registry.navOf(assetId);
        uint256 obligationsAtNAV = DecimalMath.assetToStable(assetToken.totalSupply(), nav);
        if (obligationsAtNAV == 0) return type(uint256).max;
        return Math.mulDiv(redemptionReserve, 10_000, obligationsAtNAV);
    }

    function availableRedemptionLiquidity() external view returns (uint256) {
        return redemptionReserve;
    }

    function isSolvent() public view returns (bool) {
        return totalStablecoinBalance() >= totalAccounted()
            && redemptionReserve >= minimumRequiredReserve();
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _requireUnaccounted(uint256 amount) private view {
        uint256 balance = totalStablecoinBalance();
        uint256 accounted = totalAccounted();
        if (balance < accounted || balance - accounted < amount) {
            revert InsufficientUnaccountedBalance();
        }
    }

    function _assertAccounting() private view {
        if (totalStablecoinBalance() < totalAccounted()) revert AccountingInsolvent();
    }

    function _emitAllocation(bytes32 category, int256 delta, uint256 categoryBalance) private {
        emit AllocationChanged(category, delta, categoryBalance, totalAccounted());
    }
}

