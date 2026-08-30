// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read surface of the published protected-floor level (D-025). Kept separate from the
///         contract so the market manager can depend on the level without a circular import.
interface IFloorController {
    /// @notice The published floor as a pool tick.
    function floorTick() external view returns (int24);

    /// @notice The published floor as a price, in 6-decimal mUSD per whole asset token.
    function floorPrice() external view returns (uint256);

    /// @notice True when the published floor is still at or below `min(NAV, backing)`. A NAV
    ///         markdown can make this false without the floor having moved - see the contract.
    function isFloorCovered() external view returns (bool);
}
