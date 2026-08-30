// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AssetVault } from "../vault/AssetVault.sol";

/// @notice Demo stand-in for a yield-bearing stablecoin position held against the protected
///         reserve (D-023). It holds mUSD and hands it to the vault on demand; the vault decides
///         whether the yield belongs to the reserve or to the issuer based on schedule state.
/// @dev    DEMO: a real integration would hold the reserve in a yield-bearing stable and let the
///         balance grow in place. This mock exists so the local demo can show the routing rule
///         without an external protocol. It holds no privileged role of its own - the deployer
///         grants it `YIELD_SOURCE_ROLE` on the vault.
contract MockYieldSource {
    using SafeERC20 for IERC20;

    IERC20 public immutable stablecoin;
    AssetVault public immutable vault;

    error NothingToAccrue();

    constructor(address stablecoin_, address vault_) {
        stablecoin = IERC20(stablecoin_);
        vault = AssetVault(vault_);
    }

    /// @notice Hand `amount` of held mUSD to the vault as accrued reserve yield.
    function accrue(uint256 amount) external {
        if (amount == 0 || stablecoin.balanceOf(address(this)) < amount) revert NothingToAccrue();
        stablecoin.forceApprove(address(vault), amount);
        vault.accrueReserveYield(amount);
    }

    /// @notice Everything this mock is currently able to pay out.
    function available() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }
}
