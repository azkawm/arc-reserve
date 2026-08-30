// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetToken {
    function totalSupply() external view returns (uint256);
    /// @notice Total supply minus the disclosed issuer allocation (D-024). Backing, the reserve
    ///         requirement and the redemption price are all denominated in this.
    function investorSupply() external view returns (uint256);
    function issuerAllocationSupply() external view returns (uint256);
    function isIssuerAllocation(address account) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function maximumSupply() external view returns (uint256);
    function mint(address to, uint256 amount) external;
    function burnForRedemption(address from, uint256 amount) external;
}

