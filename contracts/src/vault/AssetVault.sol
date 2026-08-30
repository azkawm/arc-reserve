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
    bytes32 public constant YIELD_SOURCE_ROLE = keccak256("YIELD_SOURCE_ROLE");
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

    /// @notice The sinking-fund schedule (D-023). `targetBacking` is mUSD per investor-held token
    ///         (6 decimals) and rises linearly from `startBacking` at `startTime` to
    ///         `targetBacking` at `maturity`. Stored rather than hardcoded so a front-loaded curve
    ///         can be introduced later without changing enforcement.
    struct ReserveSchedule {
        uint256 startBacking;
        uint256 targetBacking;
        uint64 startTime;
        uint64 maturity;
        uint64 graceSeconds;
        bool configured;
    }

    ReserveSchedule public reserveSchedule;

    /// @notice Last published shortfall start, or 0 when last observed on schedule. This mirrors
    ///         `shortfallStartedAt()` for indexers and is only as fresh as the last sync;
    ///         enforcement never reads it.
    uint64 public shortfallSince;

    event AllocationChanged(
        bytes32 indexed category, int256 delta, uint256 newCategoryBalance, uint256 totalAccounted
    );
    event InitialReserveDeposited(address indexed issuer, uint256 amount);
    event IssuerProceedsWithdrawn(address indexed issuer, uint256 amount);
    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);
    event RedemptionReleased(address indexed recipient, uint256 amount);
    event MarketFundsReleased(address indexed marketManager, uint256 amount);
    event MarketFundsReturned(address indexed marketManager, uint256 amount);
    event ReserveScheduleSet(
        uint256 startBacking,
        uint256 targetBacking,
        uint64 startTime,
        uint64 maturity,
        uint64 graceSeconds
    );
    event ReserveContribution(
        address indexed issuer, uint256 indexed periodId, uint256 amount, uint256 newReserve
    );
    event ReserveShortfallEntered(uint64 since, uint256 backing, uint256 targetBacking);
    event ReserveShortfallCleared(uint64 clearedAt, uint256 backing, uint256 targetBacking);
    event ReserveYieldAccrued(
        address indexed source, uint256 amount, bool creditedToReserve, uint256 newCategoryBalance
    );

    error InvalidAddress();
    error InvalidRatio();
    error UnauthorizedIssuer();
    error InsufficientUnaccountedBalance();
    error InsufficientCategoryBalance();
    error ReserveRequirementViolated();
    error AccountingInsolvent();
    error InvalidSchedule();
    error ReserveShortfallActive();

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
        _syncShortfall();
    }

    /// @notice Set or replace the sinking-fund schedule (D-023).
    /// @dev    In the target model this is called once at settlement with the backing the raise
    ///         actually produced. `targetBacking` is normally 1.000000 mUSD per investor token.
    function setReserveSchedule(
        uint256 startBacking,
        uint256 targetBacking,
        uint64 startTime,
        uint64 maturity,
        uint64 graceSeconds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maturity <= startTime || targetBacking == 0 || targetBacking < startBacking) {
            revert InvalidSchedule();
        }
        reserveSchedule = ReserveSchedule({
            startBacking: startBacking,
            targetBacking: targetBacking,
            startTime: startTime,
            maturity: maturity,
            graceSeconds: graceSeconds,
            configured: true
        });
        emit ReserveScheduleSet(startBacking, targetBacking, startTime, maturity, graceSeconds);
        _syncShortfall();
    }

    /// @notice Credit yield earned on the protected reserve (D-023).
    /// @dev    Destination follows the schedule: while backing is below target the yield stays with
    ///         the reserve and helps it catch up; once on or ahead of schedule it is the issuer's.
    ///         With no schedule configured the yield stays with the reserve - forgetting to set a
    ///         schedule must not silently route the investors' reserve yield to the issuer.
    ///
    ///         Funds are pulled from the caller, so classification is atomic and an accidental
    ///         transfer into the vault can never be swept up as yield. A rebasing yield-bearing
    ///         stablecoin would instead grow the balance in place; that integration would classify
    ///         the unaccounted surplus via `_requireUnaccounted` rather than pulling.
    function accrueReserveYield(uint256 amount)
        external
        onlyRole(YIELD_SOURCE_ROLE)
        nonReentrant
        whenNotPaused
    {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        bool toReserve = !reserveSchedule.configured || isBehindSchedule();
        if (toReserve) {
            redemptionReserve += amount;
            _emitAllocation("REDEMPTION_RESERVE", int256(amount), redemptionReserve);
            emit ReserveYieldAccrued(msg.sender, amount, true, redemptionReserve);
        } else {
            issuerProceeds += amount;
            _emitAllocation("ISSUER_PROCEEDS", int256(amount), issuerProceeds);
            emit ReserveYieldAccrued(msg.sender, amount, false, issuerProceeds);
        }
        _syncShortfall();
    }

    /// @notice Scheduled sinking-fund contribution from the issuer, tagged with the reporting
    ///         period it settles (D-022 period tagging).
    function depositReserve(uint256 amount, uint256 periodId) external nonReentrant whenNotPaused {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        redemptionReserve += amount;
        _emitAllocation("REDEMPTION_RESERVE", int256(amount), redemptionReserve);
        emit ReserveContribution(msg.sender, periodId, amount, redemptionReserve);
        _syncShortfall();
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
        _syncShortfall();
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
        _syncShortfall();
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
        _syncShortfall();
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
        // A redemption pays at most `currentBacking` per token, so backing for the remaining
        // holders never falls here - but the schedule target keeps rising, so re-observe.
        _syncShortfall();
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

    /// @notice Issuer withdrawal of its share of proceeds.
    /// @dev    Blocked while the reserve has been behind schedule for longer than the grace window
    ///         (D-023). The issuer's own capital is the first thing frozen when the sinking fund
    ///         falls behind - that is the enforcement mechanism behind the schedule.
    function withdrawIssuerProceeds(uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        if (amount > issuerProceeds) revert InsufficientCategoryBalance();
        _syncShortfall();
        if (isInEnforcedShortfall()) revert ReserveShortfallActive();
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

    /// @notice Reserve the vault must hold, valued at NAV over investor-held supply.
    /// @dev    Denominated in `investorSupply` rather than `totalSupply` (D-024): the issuer's own
    ///         allocation cannot redeem, so requiring reserve against it would overstate the
    ///         obligation and lock up capital no investor can ever claim.
    function minimumRequiredReserve() public view returns (uint256) {
        (uint256 nav,) = registry.navOf(assetId);
        uint256 obligationsAtNAV = DecimalMath.assetToStable(assetToken.investorSupply(), nav);
        return DecimalMath.applyBps(obligationsAtNAV, minimumReserveRatioBps);
    }

    /// @notice Reserve coverage of investor obligations at NAV, in basis points (D-024).
    function reserveRatioBps() public view returns (uint256) {
        (uint256 nav,) = registry.navOf(assetId);
        uint256 obligationsAtNAV = DecimalMath.assetToStable(assetToken.investorSupply(), nav);
        if (obligationsAtNAV == 0) return type(uint256).max;
        return Math.mulDiv(redemptionReserve, 10_000, obligationsAtNAV);
    }

    /// @notice Scheduled backing at `timestamp`, in mUSD per investor-held token (6 decimals).
    /// @dev    Flat at `startBacking` before `startTime` and at `targetBacking` from `maturity`
    ///         onward. Returns 0 when no schedule is configured, which makes every
    ///         schedule-dependent check inert rather than blocking.
    function targetBackingAt(uint64 timestamp) public view returns (uint256) {
        ReserveSchedule memory schedule = reserveSchedule;
        if (!schedule.configured) return 0;
        if (timestamp <= schedule.startTime) return schedule.startBacking;
        if (timestamp >= schedule.maturity) return schedule.targetBacking;
        uint256 elapsed = timestamp - schedule.startTime;
        uint256 span = schedule.maturity - schedule.startTime;
        uint256 climb = schedule.targetBacking - schedule.startBacking;
        return schedule.startBacking + Math.mulDiv(climb, elapsed, span);
    }

    function targetBackingNow() public view returns (uint256) {
        return targetBackingAt(uint64(block.timestamp));
    }

    /// @notice Liquid reserve per investor-held token, in mUSD (6 decimals). This is the same
    ///         quantity the redemption controller caps its price with. Returns 0 when no investor
    ///         tokens exist; use `isBehindSchedule` rather than reading 0 as a shortfall.
    function currentBacking() public view returns (uint256) {
        uint256 supply = assetToken.investorSupply();
        if (supply == 0) return 0;
        return Math.mulDiv(redemptionReserve, 1e18, supply);
    }

    /// @notice True when backing is below the scheduled level right now. An asset with no investor
    ///         tokens is never behind - there is nothing to back.
    function isBehindSchedule() public view returns (bool) {
        if (!reserveSchedule.configured) return false;
        if (assetToken.investorSupply() == 0) return false;
        return currentBacking() < targetBackingNow();
    }

    /// @notice When the rising target first overtook the current backing level, or 0 when the
    ///         reserve is on schedule.
    /// @dev    Derived, not observed. Because the target curve is monotonically increasing and the
    ///         current backing is known, the crossing time can be inverted from the schedule in
    ///         closed form - so enforcement does not depend on anyone having called
    ///         `syncShortfall`. An issuer cannot obtain a fresh grace window by letting the asset
    ///         sit dormant and then being the first to touch it.
    ///
    ///         Backing only ever rises while an asset is Active (a redemption pays at most
    ///         `currentBacking`), so inverting the *current* backing yields a crossing time at or
    ///         after the true one. The bound therefore errs in the issuer's favour and can never
    ///         over-punish.
    function shortfallStartedAt() public view returns (uint64) {
        if (!isBehindSchedule()) return 0;
        ReserveSchedule memory schedule = reserveSchedule;
        uint256 backing = currentBacking();
        if (backing <= schedule.startBacking) return schedule.startTime;
        uint256 climb = schedule.targetBacking - schedule.startBacking;
        if (climb == 0) return schedule.startTime;
        uint256 span = schedule.maturity - schedule.startTime;
        uint256 elapsed = Math.mulDiv(backing - schedule.startBacking, span, climb);
        return schedule.startTime + uint64(elapsed);
    }

    /// @notice True once a shortfall has persisted past the grace window. This is the state that
    ///         blocks issuer proceeds withdrawal (and, when implemented, headroom issuance).
    function isInEnforcedShortfall() public view returns (bool) {
        uint64 startedAt = shortfallStartedAt();
        if (startedAt == 0) return false;
        return block.timestamp >= uint256(startedAt) + reserveSchedule.graceSeconds;
    }

    /// @notice Publish a shortfall entry or exit for indexers, the verifier and the UI.
    /// @dev    Observational only. Enforcement reads `shortfallStartedAt()` directly, so a missed
    ///         call delays the *event*, never the gate. Permissionless and callable while paused.
    function syncShortfall() external returns (bool behind) {
        return _syncShortfall();
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

    function _syncShortfall() private returns (bool behind) {
        uint64 startedAt = shortfallStartedAt();
        behind = startedAt != 0;
        if (behind && shortfallSince == 0) {
            shortfallSince = startedAt;
            emit ReserveShortfallEntered(startedAt, currentBacking(), targetBackingNow());
        } else if (!behind && shortfallSince != 0) {
            shortfallSince = 0;
            emit ReserveShortfallCleared(
                uint64(block.timestamp), currentBacking(), targetBackingNow()
            );
        }
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

