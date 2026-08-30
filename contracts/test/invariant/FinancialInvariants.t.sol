// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { MockUSD } from "../../src/mocks/MockUSD.sol";
import { AssetToken } from "../../src/token/AssetToken.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { RevenueDistributor } from "../../src/revenue/RevenueDistributor.sol";
import { RedemptionController } from "../../src/redemption/RedemptionController.sol";
import { FloorController } from "../../src/market/FloorController.sol";

contract FinancialHandler {
    MockUSD private immutable musd;
    AssetToken private immutable token;
    RevenueDistributor private immutable revenue;
    RedemptionController private immutable redemption;
    AssetVault private immutable vault;
    FloorController private immutable floor;

    /// @notice Set if a redemption was ever observed to lower backing per investor token. D-025's
    ///         floor ratchet depends on this never happening while an asset is Active.
    bool public backingFellThroughRedemption;

    uint256 private periodCounter;

    constructor(
        MockUSD musd_,
        AssetToken token_,
        RevenueDistributor revenue_,
        RedemptionController redemption_,
        AssetVault vault_,
        FloorController floor_
    ) {
        musd = musd_;
        token = token_;
        revenue = revenue_;
        redemption = redemption_;
        vault = vault_;
        floor = floor_;
    }

    function depositRevenue(uint96 rawAmount) external {
        uint256 amount = uint256(rawAmount) % 1_000e6 + 1;
        musd.faucet(address(this), amount);
        musd.approve(address(revenue), amount);
        periodCounter++;
        try revenue.depositRevenue(amount, periodCounter, bytes32(periodCounter)) { } catch { }
    }

    function levelUpFloor() external {
        try floor.levelUp() { } catch { }
    }

    function claimRevenue() external {
        try revenue.claimRevenue() { } catch { }
    }

    function redeem(uint96 rawTokens) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(rawTokens) % balance + 1;
        uint256 backingBefore = vault.currentBacking();
        try redemption.redeem(amount, 0, RedemptionController.RedemptionMode.Normal) {
            // Recorded rather than asserted: a revert here would be swallowed by the handler and
            // the violation would go unreported.
            if (token.investorSupply() > 0 && vault.currentBacking() < backingBefore) {
                backingFellThroughRedemption = true;
            }
        } catch { }
    }
}

contract FinancialInvariantsTest is StdInvariant, ArcReserveTestBase {
    FinancialHandler private handler;
    FloorController private floorController;

    function setUp() public override(ArcReserveTestBase) {
        ArcReserveTestBase.setUp();
        floorController = new FloorController(
            address(vault),
            address(registry),
            assetId,
            market.assetIsToken0(),
            market.tickSpacing(),
            market.assetIsToken0() ? int24(-288_420) : int24(288_420),
            0,
            address(this)
        );
        handler = new FinancialHandler(musd, token, revenue, redemption, vault, floorController);
        revenue.grantRole(revenue.REVENUE_DEPOSITOR_ROLE(), address(handler));
        _verify(address(handler));
        _buy(address(handler), 20_000e6);
        targetContract(address(handler));
    }

    function invariantSupplyNeverExceedsMaximum() public view {
        assertLe(token.totalSupply(), token.maximumSupply());
        assertLe(revenue.excludedSupply(), token.totalSupply());
        assertEq(revenue.circulatingSupply(), token.totalSupply() - revenue.excludedSupply());
    }

    function invariantVaultAccountingIsBackedAndReserveSolvent() public view {
        assertGe(vault.totalStablecoinBalance(), vault.totalAccounted());
        assertTrue(vault.isSolvent());
    }

    function invariantClaimsCannotExceedHolderRevenue() public view {
        assertLe(revenue.totalClaimed(), revenue.totalHolderRevenue());
    }

    function invariantRedemptionsNeverOverdrawReserve() public view {
        assertGe(vault.redemptionReserve(), vault.minimumRequiredReserve());
    }

    function invariantOutstandingObligationsMatchTokenSupply() public view {
        assertEq(redemption.outstandingTokenObligations(), token.totalSupply());
    }

    /// @notice D-025: the published floor never exceeds liquid backing while investors hold tokens.
    /// @dev    Guarded on supply because backing is undefined with no investor tokens left; the
    ///         published level is then stale but claims nothing.
    function invariantFloorNeverExceedsBacking() public view {
        if (token.investorSupply() == 0) return;
        assertLe(floorController.floorPrice(), vault.currentBacking());
    }

    /// @notice D-023/D-025: a redemption pays at most `reserve / investorSupply`, so it can only
    ///         raise backing for the holders who stay. Nothing in the Active lifecycle may lower
    ///         it, which is what lets the published floor ratchet upward safely.
    function invariantBackingNeverFallsThroughRedemption() public view {
        assertFalse(handler.backingFellThroughRedemption());
    }
}
