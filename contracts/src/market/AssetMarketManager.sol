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

    uint32 public twapWindow = 30 minutes;
    uint32 public rebalanceCooldown = 30 minutes;
    uint16 public maxSpotTwapDeviationBps = 300;
    uint16 public maxMarketNAVDeviationBps = 2_000;
    int24 public maxTickShift = 1_200;

    /// @notice Published protected-floor level (D-025). Bound after deployment because the floor
    ///         controller is deployed once the market manager's pool ordering is known.
    IFloorController public floorController;
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
        vault.withdrawMarketAllocation(stablecoinAmount);
        emit MarketAllocationFunded(stablecoinAmount);
    }

    function returnStablecoinToVault(uint256 amount) external onlyRole(KEEPER_ROLE) {
        stablecoin.forceApprove(address(vault), amount);
        vault.returnMarketAllocation(amount);
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

    function collectFees(PositionKind kind)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = positions[kind];
        if (!position.configured) revert PositionNotConfigured();
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

    function slide(int24 newAnchorLower, int24 newAnchorUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 twap, uint256 nav) = _enforceSafety(true);
        if (spot <= twap) revert InvalidRange();
        _rebalance("SLIDE", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, twap, nav);
    }

    function sweep(int24 newAnchorLower, int24 newAnchorUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 twap, uint256 nav) = _enforceSafety(true);
        if (spot >= twap) revert InvalidRange();
        _rebalance("SWEEP", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, twap, nav);
    }

    function refreshDiscovery(int24 newLower, int24 newUpper) external onlyRole(KEEPER_ROLE) {
        (uint256 spot, uint256 twap, uint256 nav) = _enforceSafety(true);
        _rebalance("REFRESH_DISCOVERY", PositionKind.Discovery, newLower, newUpper, spot, twap, nav);
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

        (uint256 spot, uint256 twap, uint256 nav) = _enforceSafety(true);
        _rebalance(
            "REBALANCE_TO_FLOOR", PositionKind.ReserveFloor, newLower, newUpper, spot, twap, nav
        );
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
        (uint256 spot, uint256 twap, uint256 nav) = _enforceSafety(true);
        _rebalance(
            "REBALANCE_TO_NAV", PositionKind.Anchor, newAnchorLower, newAnchorUpper, spot, twap, nav
        );
    }

    function marketPrices()
        public
        view
        returns (uint256 spotPrice, uint256 twapPrice, int24 meanTick)
    {
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;
        (int56[] memory cumulativeTicks,) = pool.observe(secondsAgos);
        int56 delta = cumulativeTicks[1] - cumulativeTicks[0];
        meanTick = int24(delta / int56(uint56(twapWindow)));
        if (delta < 0 && delta % int56(uint56(twapWindow)) != 0) meanTick--;
        uint160 twapSqrtPriceX96 = TickPriceMath.getSqrtRatioAtTick(meanTick);
        spotPrice = _stablePrice(sqrtPriceX96);
        twapPrice = _stablePrice(twapSqrtPriceX96);
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
        (spot, twap,) = marketPrices();
        (nav,) = registry.navOf(assetId);
        if (DecimalMath.deviationBps(spot, twap) > maxSpotTwapDeviationBps) {
            return (SafetyFailure.SpotTwapDeviation, spot, twap, nav);
        }
        if (DecimalMath.deviationBps(twap, nav) > maxMarketNAVDeviationBps) {
            return (SafetyFailure.MarketNAVDeviation, spot, twap, nav);
        }
        if (!vault.isSolvent()) {
            return (SafetyFailure.ReserveBelowMinimum, spot, twap, nav);
        }
        if (
            includeCooldown && lastRebalanceAt != 0
                && block.timestamp < lastRebalanceAt + rebalanceCooldown
        ) return (SafetyFailure.Cooldown, spot, twap, nav);
        return (SafetyFailure.None, spot, twap, nav);
    }

    function setSafetyPolicy(
        uint32 twapWindow_,
        uint32 cooldown_,
        uint16 spotTwapBps_,
        uint16 marketNavBps_,
        int24 maxTickShift_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            twapWindow_ == 0 || cooldown_ == 0 || spotTwapBps_ == 0 || spotTwapBps_ > 10_000
                || marketNavBps_ == 0 || marketNavBps_ > 10_000 || maxTickShift_ <= 0
        ) revert InvalidPolicy();
        twapWindow = twapWindow_;
        rebalanceCooldown = cooldown_;
        maxSpotTwapDeviationBps = spotTwapBps_;
        maxMarketNAVDeviationBps = marketNavBps_;
        maxTickShift = maxTickShift_;
        emit SafetyPolicyUpdated(twapWindow_, cooldown_, spotTwapBps_, marketNavBps_, maxTickShift_);
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
        uint256 twap,
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
        emit Rebalanced(operation, spot, twap, nav, anchor.tickLower, anchor.tickUpper);
    }

    function _enforceSafety(bool includeCooldown)
        private
        view
        returns (uint256 spot, uint256 twap, uint256 nav)
    {
        (SafetyFailure failure, uint256 spot_, uint256 twap_, uint256 nav_) =
            safetyState(includeCooldown);
        if (failure != SafetyFailure.None) revert SafetyCheckFailed(failure);
        return (spot_, twap_, nav_);
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
