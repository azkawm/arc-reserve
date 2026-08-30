// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetVault {
    function recordPrimaryProceeds(
        uint256 issuerAmount,
        uint256 reserveAmount,
        uint256 marketAmount
    ) external;
    function creditRevenueReserve(uint256 reserveAmount, uint256 protocolAmount) external;
    function releaseRedemption(address recipient, uint256 amount) external;
    function withdrawMarketAllocation(uint256 amount) external;
    function returnMarketAllocation(uint256 amount) external;
    function redemptionReserve() external view returns (uint256);
    function marketMakingAllocation() external view returns (uint256);
    function minimumRequiredReserve() external view returns (uint256);
    function reserveRatioBps() external view returns (uint256);
    function availableRedemptionLiquidity() external view returns (uint256);
    function isSolvent() external view returns (bool);
    /// @notice True when liquid backing per investor token is below the D-023 schedule right now.
    function isBehindSchedule() external view returns (bool);
    /// @notice Par cap for maturity redemption, or 0 when no schedule is configured (D-023).
    function maturityParValue() external view returns (uint256);
    /// @notice When maturity redemption closes, or 0 when no window is configured.
    function maturityWindowEndsAt() external view returns (uint64);
}

