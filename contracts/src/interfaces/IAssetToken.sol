// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssetToken {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function maximumSupply() external view returns (uint256);
    function mint(address to, uint256 amount) external;
    function burnForRedemption(address from, uint256 amount) external;
}

