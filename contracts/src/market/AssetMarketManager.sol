// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAssetRegistry } from "../interfaces/IAssetRegistry.sol";
import { IAssetVault } from "../interfaces/IAssetVault.sol";
import {
    IUniswapV3Pool,
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback
} from "../interfaces/IUniswapV3Pool.sol";
import { DecimalMath } from "../libraries/DecimalMath.sol";
import { TickPriceMath } from "../libraries/TickPriceMath.sol";
import { IFloorController } from "../interfaces/IFloorController.sol";

/// @notice ARC Liquidity Engine for one canonical Uniswap V3 asset/mUSD pool.
/// @dev Rebalances remove active liquidity before changing ranges; a keeper then remints explicitly.
///
///      D-036: THIS ENGINE NO LONGER USES A TWAP. `pool.observe` is never called, no time-weighted
///      price is published, and the spot/TWAP deviation gate is gone. Consequences, all deliberate:
///      - `marketPrices()` keeps its three-value shape for ABI stability but returns 0 in both the
///        `twapPrice` and `meanTick` slots. A price of 0 cannot occur legitimately, so it reads as
///        "not published" rather than as a plausible wrong number.
///      - `maxMarketNAVDeviationBps` now compares SPOT to NAV and is the only market guard left.
///        It reacts to a single trade instead of a half-hour average, so it fires more often than
///        it used to. That is the trade, not a regression.
///      - `slide` and `sweep` take their direction from the anchor position's own range rather
///        than from spot-versus-TWAP: while spot sits inside the range the position is working,
///        and once spot leaves it the position is single-sided and the anchor must follow.
///      - `SafetyFailure.SpotTwapDeviation` keeps value 5, reserved and never returned, so no
///        consumer's failure-code mapping shifts.
contract AssetMarketManager is
    AccessControl,
    Pausable,
    ReentrancyGuard,
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback
{
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev Uniswap V3's price bounds. A swap with its limit set at the extreme runs until the
    ///      input is spent or liquidity is exhausted, whichever comes first.
    uint160 private constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant MAX_SQRT_RATIO =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    enum PositionKind {
        ReserveFloor,
        Anchor,
        Discovery,
        Intermediary
    }

    enum SafetyFailure {
        None,
        Paused,
        AssetNotActive,
        Matured,
        StaleNAV,
        SpotTwapDeviation,
        MarketNAVDeviation,
        ReserveBelowMinimum,
        Cooldown
    }

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool configured;
    }

    struct CallbackData {
        address token0;
        address token1;
        uint256 maxAmount0;
        uint256 maxAmount1;
        bool zeroForOne;
        uint64 nonce;
    }

    struct AddLiquidityParams {
        PositionKind kind;
        uint128 liquidity;
        uint256 maxAmount0;
        uint256 maxAmount1;
        uint256 minimumAmount0;
        uint256 minimumAmount1;
        uint256 deadline;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        uint256 maximumInput;
        uint256 minimumOutput;
        uint256 deadline;
    }

    IUniswapV3Pool public immutable pool;
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    IERC20 public immutable assetToken;
    IERC20 public immutable stablecoin;
    IAssetVault public immutable vault;
    IAssetRegistry public immutable registry;
    bytes32 public immutable assetId;
    bool public immutable assetIsToken0;
    int24 public immutable tickSpacing;

    uint32 public rebalanceCooldown = 30 minutes;
    /// @notice Maximum deviation between SPOT and verified NAV. Since D-036 removed the TWAP this
    ///         is the only market guard, and it reads spot directly rather than a smoothed average.
    uint16 public maxMarketNAVDeviationBps = 2_000;
    int24 public maxTickShift = 1_200;

    /// @notice Published protected-floor level (D-025). Bound after deployment because the floor
    ///         controller is deployed once the market manager's pool ordering is known.
    IFloorController public floorController;
    /// @notice Stable drawn from the vault's market allocation and not yet returned — the cost
    ///         basis for D-035 surplus. Anything the manager holds ABOVE this was earned by the
    ///         market, not borrowed from the vault, and is therefore creditable to the reserve.
    uint256 public principalOutstanding;
    uint64 public lastRebalanceAt;
    uint64 private _callbackNonce;
    bytes32 private _activeMintCallback;
    bytes32 private _activeSwapCallback;

    mapping(PositionKind => Position) public positions;

    event PositionConfigured(PositionKind indexed kind, int24 tickLower, int24 tickUpper);
    event FloorControllerSet(address indexed controller);
    event PositionLiquidityAdded(
        PositionKind indexed kind, uint128 liquidity, uint256 amount0, uint256 amount1
    );
    event PositionLiquidityRemoved(
        PositionKind indexed kind, uint128 liquidity, uint256 amount0, uint256 amount1
    );
    event FeesCollected(PositionKind indexed kind, uint256 amount0, uint256 amount1);
    event Rebalanced(
        bytes32 indexed operation,
        uint256 spotPrice,
        uint256 twapPrice,
        uint256 nav,
        int24 anchorLower,
        int24 anchorUpper
    );
    event SwapExecuted(
        bool indexed zeroForOne, uint256 amountIn, uint256 amountOut, uint160 sqrtPriceLimitX96
    );
    event MarketAllocationFunded(uint256 amount);
    event TokenInventoryFunded(address indexed funder, uint256 amount);
    /// @notice The opportunistic level-up on the rebalance path did not run, and why (D-036).
    ///         Never an error: a rebalance must not fail because the floor could not advance.
    event FloorLevelUpSkipped(bytes32 reason);
    event SwapExactInput(
        address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut
    );
    /// @notice D-035: realised market surplus handed to the vault's protected reserve.
    event SurplusCredited(uint256 amount);
    /// @notice A flywheel step did not run, and why. Informational — the trade still settled.
    event FlywheelSkipped(bytes32 reason);
    event SafetyPolicyUpdated(
        uint32 twapWindow,
        uint32 cooldown,
        uint16 spotTwapBps,
        uint16 marketNavBps,
        int24 maxTickShift
    );

    error InvalidAddress();
    error FloorControllerNotSet();
    error RangeAboveFloor();
    error InvalidPoolTokens();
    error InvalidRange();
    error PositionNotConfigured();
    error PositionHasLiquidity();
    error DeadlineExpired();
    error SafetyCheckFailed(SafetyFailure reason);
    error InvalidCallback();
    error SlippageExceeded();
    error InvalidSwapDirection();
    error InvalidPolicy();

    constructor(
        address pool_,
        address assetToken_,
        address stablecoin_,
        address vault_,
        address registry_,
        bytes32 assetId_,
        address admin
    ) {
        if (
            pool_ == address(0) || assetToken_ == address(0) || stablecoin_ == address(0)
                || vault_ == address(0) || registry_ == address(0) || admin == address(0)
        ) revert InvalidAddress();
        pool = IUniswapV3Pool(pool_);
        address poolToken0 = IUniswapV3Pool(pool_).token0();
        address poolToken1 = IUniswapV3Pool(pool_).token1();
        if (!((poolToken0 == assetToken_ && poolToken1 == stablecoin_)
                    || (poolToken0 == stablecoin_ && poolToken1 == assetToken_))) revert InvalidPoolTokens();
        int24 spacing = IUniswapV3Pool(pool_).tickSpacing();
        if (spacing <= 0) revert InvalidRange();
        token0 = IERC20(poolToken0);
        token1 = IERC20(poolToken1);
        assetToken = IERC20(assetToken_);
        stablecoin = IERC20(stablecoin_);
        vault = IAssetVault(vault_);
        registry = IAssetRegistry(registry_);
        assetId = assetId_;
        assetIsToken0 = poolToken0 == assetToken_;
        tickSpacing = spacing;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function configureCorePositions(
        int24 reserveLower,
        int24 reserveUpper,
        int24 anchorLower,
        int24 anchorUpper
    ) external onlyRole(KEEPER_ROLE) {
        _configure(PositionKind.ReserveFloor, reserveLower, reserveUpper);
        _configure(PositionKind.Anchor, anchorLower, anchorUpper);
    }

    function configureOptionalPosition(PositionKind kind, int24 lower, int24 upper)
        external
        onlyRole(KEEPER_ROLE)
    {
        if (kind != PositionKind.Discovery && kind != PositionKind.Intermediary) {
            revert InvalidRange();
        }
        _configure(kind, lower, upper);
    }

    function fundFromVault(uint256 stablecoinAmount) external onlyRole(KEEPER_ROLE) whenNotPaused {
        _enforceSafety(false);
        principalOutstanding += stablecoinAmount;
        vault.withdrawMarketAllocation(stablecoinAmount);
        emit MarketAllocationFunded(stablecoinAmount);
    }

    function returnStablecoinToVault(uint256 amount) external onlyRole(KEEPER_ROLE) {
        // Saturating: returning more than was drawn simply clears the basis rather than reverting.
        principalOutstanding = amount >= principalOutstanding ? 0 : principalOutstanding - amount;
        stablecoin.forceApprove(address(vault), amount);
        vault.returnMarketAllocation(amount);
    }

    /// @notice Stable the manager holds beyond what it drew from the vault (D-035).
    /// @dev    Conservative by construction. Stable locked inside pool positions is not in this
    ///         balance, so an under-water manager reads 0 rather than over-crediting; the figure
    ///         only goes positive once the market has actually returned more than was borrowed —
    ///         inventory sold through discovery, or fees collected in mUSD. Both are real surplus.
    function creditableSurplus() public view returns (uint256) {
        uint256 balance = stablecoin.balanceOf(address(this));
        return balance > principalOutstanding ? balance - principalOutstanding : 0;
    }

    /// @notice Asset inventory must be transferred in; this manager has no minting authority.
    function fundTokenInventory(uint256 amount) external whenNotPaused {
        assetToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TokenInventoryFunded(msg.sender, amount);
    }

    function addLiquidity(AddLiquidityParams calldata params)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > params.deadline) {
            revert DeadlineExpired();
        }
        _enforceSafety(false);
        Position storage position = positions[params.kind];
        if (!position.configured) revert PositionNotConfigured();

        CallbackData memory callback = CallbackData({
            token0: address(token0),
            token1: address(token1),
            maxAmount0: params.maxAmount0,
            maxAmount1: params.maxAmount1,
            zeroForOne: false,
            nonce: ++_callbackNonce
        });
        bytes memory data = abi.encode(callback);
        _activeMintCallback = keccak256(data);
        (amount0, amount1) = pool.mint(
            address(this), position.tickLower, position.tickUpper, params.liquidity, data
        );
        _activeMintCallback = bytes32(0);
        if (
            amount0 > params.maxAmount0 || amount1 > params.maxAmount1
                || amount0 < params.minimumAmount0 || amount1 < params.minimumAmount1
        ) revert SlippageExceeded();
        position.liquidity += params.liquidity;
        emit PositionLiquidityAdded(params.kind, params.liquidity, amount0, amount1);
    }

    function removeLiquidity(
        PositionKind kind,
        uint128 liquidity,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        uint256 deadline
    ) external onlyRole(KEEPER_ROLE) nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        Position storage position = positions[kind];
        if (!position.configured || liquidity == 0 || liquidity > position.liquidity) {
            revert PositionNotConfigured();
        }
        (uint256 burned0, uint256 burned1) =
            pool.burn(position.tickLower, position.tickUpper, liquidity);
        (uint128 collected0, uint128 collected1) = pool.collect(
            address(this),
            position.tickLower,
            position.tickUpper,
            uint128(Math.min(burned0, type(uint128).max)),
            uint128(Math.min(burned1, type(uint128).max))
        );
        amount0 = collected0;
        amount1 = collected1;
        if (amount0 < minimumAmount0 || amount1 < minimumAmount1) revert SlippageExceeded();
        position.liquidity -= liquidity;
        emit PositionLiquidityRemoved(kind, liquidity, amount0, amount1);
    }

    /// @notice Collect accrued swap fees for one position.
    /// @dev    A Uniswap V3 pool only credits a position's `tokensOwed` when the position is
    ///         *touched*. Fee growth accumulates globally as swaps cross the range, but it is not
    ///         attributed until a mint or burn recomputes it. Collecting without that recompute
    ///         therefore returns 0 even when real fees exist, and a keeper reading 0 would
    ///         reasonably conclude there was nothing to collect. Confirmed on a Base Sepolia fork
    ///         (`test/fork/BaseSepoliaMarket.t.sol`): before a poke this returned 0/0 after real
    ///         swaps; after the position was touched the same call returned 491,447.
    ///
    ///         So poke first, with a zero-liquidity burn — the canonical way to force the recompute
    ///         without changing the position.
    ///
    ///         The poke is CONDITIONAL, and that is not an optimisation. v3's `Position.update`
    ///         reverts `NP` for a zero-liquidity burn against a position holding no liquidity, so
    ///         an unconditional poke would break collecting *after* a full `removeLiquidity` — and
    ///         that is exactly when a keeper collects the fees the removal left owed. With no
    ///         liquidity there is nothing to recompute anyway: the burn that emptied the position
    ///         already credited everything.
    function collectFees(PositionKind kind)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = positions[kind];
        if (!position.configured) revert PositionNotConfigured();
        if (position.liquidity != 0) {
            pool.burn(position.tickLower, position.tickUpper, 0);
        }
        (uint128 collected0, uint128 collected1) = pool.collect(
            address(this),
            position.tickLower,
            position.tickUpper,
            type(uint128).max,
            type(uint128).max
        );
        amount0 = collected0;
        amount1 = collected1;
        emit FeesCollected(kind, amount0, amount1);
    }

    function executeSwap(SwapParams calldata params)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 amountIn, uint256 amountOut)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.amountSpecified == 0) revert InvalidSwapDirection();
        _enforceSafety(false);
        CallbackData memory callback = CallbackData({
            token0: address(token0),
            token1: address(token1),
            maxAmount0: params.zeroForOne ? params.maximumInput : 0,
            maxAmount1: params.zeroForOne ? 0 : params.maximumInput,
            zeroForOne: params.zeroForOne,
            nonce: ++_callbackNonce
        });
        bytes memory data = abi.encode(callback);
        _activeSwapCallback = keccak256(data);
        (int256 amount0, int256 amount1) = pool.swap(
            address(this), params.zeroForOne, params.amountSpecified, params.sqrtPriceLimitX96, data
        );
        _activeSwapCallback = bytes32(0);

        int256 inputDelta = params.zeroForOne ? amount0 : amount1;
        int256 outputDelta = params.zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0) revert InvalidSwapDirection();
        amountIn = uint256(inputDelta);
        amountOut = uint256(-outputDelta);
        if (amountIn > params.maximumInput || amountOut < params.minimumOutput) {
            revert SlippageExceeded();
        }
        emit SwapExecuted(params.zeroForOne, amountIn, amountOut, params.sqrtPriceLimitX96);
    }

    /// @notice Trade against the asset's pool and turn the crank (D-035).
    /// @dev    Permissionless: this is the public trading entry point, not a keeper action. The
    ///         compliance perimeter still holds without extra checks — the pool pays the caller
    ///         directly, so `AssetToken` rejects an unverified recipient, and an unverified seller
    ///         cannot transfer tokens in.
    ///
    ///         After the trade settles, the flywheel runs: harvest what the market converted,
    ///         cross the realised surplus into the protected reserve, and let the floor ratchet.
    ///         Every one of those steps is allowed to fail silently with a reason — **a trader's
    ///         swap must never revert because the engine could not tidy up afterwards.**
    function swapExactInput(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert InvalidSwapDirection();
        bool zeroForOne = tokenIn == address(token0);
        if (!zeroForOne && tokenIn != address(token1)) revert InvalidPoolTokens();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _routeSwap(zeroForOne, amountIn, minAmountOut, tokenIn);
        emit SwapExactInput(msg.sender, tokenIn, amountIn, amountOut);

        _runFlywheel();
    }

    /// @notice Move the anchor after the price has left its range on the UPSIDE.
    /// @dev    D-036: the signal is the anchor's own range, not spot-versus-TWAP. Orientation-aware,
    ///         because with the asset as token1 a higher price is a LOWER tick.
    function slide(int24 newAnchorLower, int24 newAnchorUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 nav) = _enforceSafety(true);
        if (!_spotLeftAnchor(true)) revert InvalidRange();
        _rebalance("SLIDE", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, nav);
    }

    /// @notice Move the anchor after the price has left its range on the DOWNSIDE.
    function sweep(int24 newAnchorLower, int24 newAnchorUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 nav) = _enforceSafety(true);
        if (!_spotLeftAnchor(false)) revert InvalidRange();
        _rebalance("SWEEP", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, nav);
    }

    function refreshDiscovery(int24 newLower, int24 newUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 nav) = _enforceSafety(true);
        _rebalance("REFRESH_DISCOVERY", PositionKind.Discovery, newLower, newUpper, spot, nav);
    }

    /// @notice Reposition the market-floor range so it sits at or below the published floor level.
    /// @dev    The market-floor position is market inventory, not protected reserve (D-014). This
    ///         only constrains where it may sit: the highest price the range can reach must be at
    ///         or below the published floor, so the engine never bids above the level it publishes.
    ///         Direction-aware, because with the asset as token1 a higher price is a *lower* tick.
    function rebalanceToFloor(int24 newLower, int24 newUpper) external onlyRole(KEEPER_ROLE) {
        IFloorController controller = floorController;
        if (address(controller) == address(0)) revert FloorControllerNotSet();
        int24 floorTick = controller.floorTick();
        // The tick at which this range reaches its highest price.
        int24 priceCeilingTick = assetIsToken0 ? newUpper : newLower;
        bool withinFloor =
            assetIsToken0 ? priceCeilingTick <= floorTick : priceCeilingTick >= floorTick;
        if (!withinFloor) revert RangeAboveFloor();

        (uint256 spot, uint256 nav) = _enforceSafety(true);
        _rebalance("REBALANCE_TO_FLOOR", PositionKind.ReserveFloor, newLower, newUpper, spot, nav);
    }

    function setFloorController(address controller) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (controller == address(0)) revert InvalidAddress();
        floorController = IFloorController(controller);
        emit FloorControllerSet(controller);
    }

    function rebalanceToNAV(int24 newAnchorLower, int24 newAnchorUpper)
        external
        onlyRole(KEEPER_ROLE)
    {
        (uint256 spot, uint256 nav) = _enforceSafety(true);
        _rebalance(
            "REBALANCE_TO_NAV", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, nav
        );
    }

    /// @notice The market price from `slot0`.
    /// @dev    D-036: the engine no longer publishes a time-weighted price. The three-value shape
    ///         is kept so no consumer has to re-decode, but `twapPrice` and `meanTick` are ALWAYS
    ///         0 and carry no information. Returning spot in the `twapPrice` slot was considered
    ///         and rejected: it would serve a plausible number under a wrong label, which is
    ///         exactly the failure a consumer cannot detect. 0 is never a legitimate price, so it
    ///         reads as "not published". Read the spot tick from `pool.slot0()` directly.
    function marketPrices()
        public
        view
        returns (uint256 spotPrice, uint256 twapPrice, int24 meanTick)
    {
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        spotPrice = _stablePrice(sqrtPriceX96);
        twapPrice = 0;
        meanTick = 0;
    }

    function safetyState(bool includeCooldown)
        public
        view
        returns (SafetyFailure failure, uint256 spot, uint256 twap, uint256 nav)
    {
        if (paused()) return (SafetyFailure.Paused, 0, 0, 0);
        IAssetRegistry.AssetStatus status = registry.statusOf(assetId);
        if (status != IAssetRegistry.AssetStatus.Active) {
            return (SafetyFailure.AssetNotActive, 0, 0, 0);
        }
        if (block.timestamp >= registry.maturityOf(assetId)) {
            return (SafetyFailure.Matured, 0, 0, 0);
        }
        if (registry.isNAVStale(assetId)) return (SafetyFailure.StaleNAV, 0, 0, 0);
        (spot,,) = marketPrices();
        (nav,) = registry.navOf(assetId);
        // D-036: `SafetyFailure.SpotTwapDeviation` (value 5) is RESERVED and never returned. The
        // value is kept so no consumer's failure-code mapping shifts underneath it.
        if (DecimalMath.deviationBps(spot, nav) > maxMarketNAVDeviationBps) {
            return (SafetyFailure.MarketNAVDeviation, spot, 0, nav);
        }
        if (!vault.isSolvent()) {
            return (SafetyFailure.ReserveBelowMinimum, spot, 0, nav);
        }
        if (
            includeCooldown && lastRebalanceAt != 0
                && block.timestamp < lastRebalanceAt + rebalanceCooldown
        ) return (SafetyFailure.Cooldown, spot, 0, nav);
        return (SafetyFailure.None, spot, 0, nav);
    }

    /// @notice Update the market safety policy.
    /// @dev    D-036: the FIRST and THIRD parameters (formerly `twapWindow` and `spotTwapBps`) are
    ///         ACCEPTED AND IGNORED. The TWAP is gone and both configure nothing. The five-parameter
    ///         shape is retained deliberately so no caller has to re-encode, but their validation is
    ///         dropped so a caller can pass 0 and mean "not applicable" rather than being forced to
    ///         supply a meaningful-looking number for a dead knob — and they are emitted as 0 for
    ///         the same reason. Setting 1800 here configures NOTHING. Left unnamed so the compiler
    ///         cannot be told they are used.
    function setSafetyPolicy(
        uint32,
        uint32 cooldown_,
        uint16,
        uint16 marketNavBps_,
        int24 maxTickShift_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (cooldown_ == 0 || marketNavBps_ == 0 || marketNavBps_ > 10_000 || maxTickShift_ <= 0) revert InvalidPolicy();
        rebalanceCooldown = cooldown_;
        maxMarketNAVDeviationBps = marketNavBps_;
        maxTickShift = maxTickShift_;
        emit SafetyPolicyUpdated(0, cooldown_, 0, marketNavBps_, maxTickShift_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data)
        external
    {
        if (msg.sender != address(pool) || _activeMintCallback != keccak256(data)) {
            revert InvalidCallback();
        }
        CallbackData memory callback = abi.decode(data, (CallbackData));
        _validateCallbackTokens(callback);
        if (amount0Owed > callback.maxAmount0 || amount1Owed > callback.maxAmount1) {
            revert SlippageExceeded();
        }
        if (amount0Owed != 0) token0.safeTransfer(msg.sender, amount0Owed);
        if (amount1Owed != 0) token1.safeTransfer(msg.sender, amount1Owed);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data)
        external
    {
        if (msg.sender != address(pool) || _activeSwapCallback != keccak256(data)) {
            revert InvalidCallback();
        }
        CallbackData memory callback = abi.decode(data, (CallbackData));
        _validateCallbackTokens(callback);
        if (callback.zeroForOne) {
            if (amount0Delta <= 0 || amount1Delta >= 0) revert InvalidSwapDirection();
            uint256 owed = uint256(amount0Delta);
            if (owed > callback.maxAmount0) revert SlippageExceeded();
            token0.safeTransfer(msg.sender, owed);
        } else {
            if (amount1Delta <= 0 || amount0Delta >= 0) revert InvalidSwapDirection();
            uint256 owed = uint256(amount1Delta);
            if (owed > callback.maxAmount1) revert SlippageExceeded();
            token1.safeTransfer(msg.sender, owed);
        }
    }

    function _configure(PositionKind kind, int24 lower, int24 upper) private {
        Position storage position = positions[kind];
        if (position.liquidity != 0) revert PositionHasLiquidity();
        _validateRange(lower, upper);
        position.tickLower = lower;
        position.tickUpper = upper;
        position.configured = true;
        emit PositionConfigured(kind, lower, upper);
    }

    function _rebalance(
        bytes32 operation,
        PositionKind kind,
        int24 newLower,
        int24 newUpper,
        uint256 spot,
        uint256 nav
    ) private {
        Position storage position = positions[kind];
        if (!position.configured) revert PositionNotConfigured();
        if (position.liquidity != 0) revert PositionHasLiquidity();
        if (
            _absoluteTickDifference(position.tickLower, newLower) > uint24(maxTickShift)
                || _absoluteTickDifference(position.tickUpper, newUpper) > uint24(maxTickShift)
        ) revert InvalidRange();
        _validateRange(newLower, newUpper);
        position.tickLower = newLower;
        position.tickUpper = newUpper;
        lastRebalanceAt = uint64(block.timestamp);
        emit PositionConfigured(kind, newLower, newUpper);
        Position storage anchor = positions[PositionKind.Anchor];
        // D-036: the third argument is the retired `twapPrice` field. It is kept in the event so no
        // indexer has to re-decode, and is ALWAYS 0 — emitting spot there would store a plausible
        // number under a wrong label in every consumer's history.
        emit Rebalanced(operation, spot, 0, nav, anchor.tickLower, anchor.tickUpper);

        // Interactions last: every state change above is already committed.
        _tryLevelUpFloor();
    }

    /// @dev D-036: opportunistically advance the published floor whenever a rebalance happens, so
    ///      the level tracks a rising reserve without needing a separate keeper call. It must never
    ///      take the rebalance down with it: failing on cooldown or ceiling is a NORMAL outcome, so
    ///      every path here is swallowed and reported as a skip reason instead.
    ///
    ///      Deliberately NOT `nonReentrant` (owner decision, D-036). The residual exposure is an
    ///      admin-trust assumption, documented in SECURITY.md: `floorController` is set only by
    ///      DEFAULT_ADMIN_ROLE, and an admin who can install a hostile controller can already pause
    ///      the market, rewrite this policy and grant roles. A re-entering controller holds no role
    ///      of its own, and every rebalance, funding and swap entry point is KEEPER_ROLE gated, so
    ///      there is no path it can re-enter productively. `levelUp` also touches only the
    ///      controller's own state, so there is no half-written manager state to catch. Note too
    ///      that `levelUp` is already permissionless — bundling it here grants nobody a capability
    ///      they did not already have.
    function _tryLevelUpFloor() private {
        IFloorController controller = floorController;
        if (address(controller) == address(0)) {
            emit FloorLevelUpSkipped("NO_CONTROLLER");
            return;
        }
        try controller.canLevelUp() returns (bool eligible) {
            if (!eligible) {
                emit FloorLevelUpSkipped("NOT_ELIGIBLE");
                return;
            }
        } catch {
            emit FloorLevelUpSkipped("CAN_LEVEL_UP_REVERTED");
            return;
        }
        try controller.levelUp() returns (int24) { }
        catch {
            emit FloorLevelUpSkipped("LEVEL_UP_REVERTED");
        }
    }

    function _routeSwap(bool zeroForOne, uint256 amountIn, uint256 minAmountOut, address tokenIn)
        private
        returns (uint256 amountOut)
    {
        bytes memory data = _encodeSwapCallback(zeroForOne, amountIn);
        _activeSwapCallback = keccak256(data);
        (int256 amount0, int256 amount1) = pool.swap(
            msg.sender,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            data
        );
        _activeSwapCallback = bytes32(0);

        int256 inputDelta = zeroForOne ? amount0 : amount1;
        int256 outputDelta = zeroForOne ? amount1 : amount0;
        if (inputDelta <= 0 || outputDelta >= 0) revert InvalidSwapDirection();
        amountOut = uint256(-outputDelta);
        if (amountOut < minAmountOut) revert SlippageExceeded();

        // A swap that stops at the price limit leaves input unspent. Refund it — left here it
        // would sit in the manager's balance and be miscounted as market surplus on the next
        // credit, quietly converting a trader's own money into protected reserve.
        uint256 spent = uint256(inputDelta);
        if (spent < amountIn) IERC20(tokenIn).safeTransfer(msg.sender, amountIn - spent);
    }

    function _encodeSwapCallback(bool zeroForOne, uint256 amountIn) private returns (bytes memory) {
        return abi.encode(
            CallbackData({
                token0: address(token0),
                token1: address(token1),
                maxAmount0: zeroForOne ? amountIn : 0,
                maxAmount1: zeroForOne ? 0 : amountIn,
                zeroForOne: zeroForOne,
                nonce: ++_callbackNonce
            })
        );
    }

    /// @dev D-035, the flywheel. Discovery sells SOLAR01 above market, the proceeds become backing,
    ///      higher backing lets the published floor ratchet, and the floor position follows it up.
    ///      Until this existed, trading did nothing to backing at all.
    function _runFlywheel() private {
        _harvestDiscovery();
        _creditSurplus();
        _tryLevelUpFloor();
    }

    /// @dev Discovery sits above spot holding SOLAR01. When price rises through it the pool
    ///      converts that inventory to mUSD — but the proceeds stay INSIDE the position until it is
    ///      burned, so burning is what realises them. That is why the harvest comes before the
    ///      credit rather than after. `collect` requests the maximum so accrued fees come too.
    ///
    ///      Not re-minted here: re-minting into a moved range needs the `L'` liquidity maths the
    ///      repo does not have yet. A keeper refills through the existing `addLiquidity`, where the
    ///      liquidity is supplied explicitly and guarded by its own slippage bounds.
    function _harvestDiscovery() private {
        Position storage position = positions[PositionKind.Discovery];
        uint128 liquidity = position.liquidity;
        if (!position.configured || liquidity == 0) {
            emit FlywheelSkipped("NO_DISCOVERY_LIQUIDITY");
            return;
        }
        position.liquidity = 0;
        pool.burn(position.tickLower, position.tickUpper, liquidity);
        (uint128 collected0, uint128 collected1) = pool.collect(
            address(this),
            position.tickLower,
            position.tickUpper,
            type(uint128).max,
            type(uint128).max
        );
        emit PositionLiquidityRemoved(PositionKind.Discovery, liquidity, collected0, collected1);
    }

    /// @dev Guarded because the vault is pausable and pausing it must not break trading.
    function _creditSurplus() private {
        uint256 surplus = creditableSurplus();
        if (surplus == 0) {
            emit FlywheelSkipped("NO_SURPLUS");
            return;
        }
        stablecoin.forceApprove(address(vault), surplus);
        try vault.creditMarketSurplus(surplus) {
            emit SurplusCredited(surplus);
        } catch {
            stablecoin.forceApprove(address(vault), 0);
            emit FlywheelSkipped("CREDIT_REVERTED");
        }
    }

    /// @dev True when the spot tick has left the anchor's range on the requested side, in PRICE
    ///      terms. With the asset as token1 a higher price is a lower tick, so the comparison
    ///      inverts - this is the orientation bug class `SECURITY.md` flags, handled explicitly.
    function _spotLeftAnchor(bool upside) private view returns (bool) {
        Position storage anchor = positions[PositionKind.Anchor];
        if (!anchor.configured) revert PositionNotConfigured();
        (, int24 spotTick,,,,,) = pool.slot0();
        if (upside) {
            return assetIsToken0 ? spotTick > anchor.tickUpper : spotTick < anchor.tickLower;
        }
        return assetIsToken0 ? spotTick < anchor.tickLower : spotTick > anchor.tickUpper;
    }

    function _enforceSafety(bool includeCooldown) private view returns (uint256 spot, uint256 nav) {
        (SafetyFailure failure, uint256 spot_,, uint256 nav_) = safetyState(includeCooldown);
        if (failure != SafetyFailure.None) revert SafetyCheckFailed(failure);
        return (spot_, nav_);
    }

    function _validateRange(int24 lower, int24 upper) private view {
        if (
            lower >= upper || lower < TickPriceMath.MIN_TICK || upper > TickPriceMath.MAX_TICK
                || lower % tickSpacing != 0 || upper % tickSpacing != 0
        ) revert InvalidRange();
    }

    function _validateCallbackTokens(CallbackData memory callback) private view {
        if (callback.token0 != address(token0) || callback.token1 != address(token1)) {
            revert InvalidCallback();
        }
    }

    function _stablePrice(uint160 sqrtPriceX96) private view returns (uint256) {
        uint256 q96 = 1 << 96;
        uint256 rawRatioX96 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, q96);
        if (rawRatioX96 == 0) return 0;
        return
            assetIsToken0
                ? Math.mulDiv(rawRatioX96, 1e18, q96)
                : Math.mulDiv(1e18, q96, rawRatioX96);
    }

    function _absoluteTickDifference(int24 a, int24 b) private pure returns (uint24) {
        int256 difference = int256(a) - int256(b);
        return uint24(uint256(difference < 0 ? -difference : difference));
    }
}
