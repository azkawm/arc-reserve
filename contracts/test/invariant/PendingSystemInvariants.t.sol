// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { ArcReserveTestBase } from "../ArcReserveTestBase.sol";
import { MockUSD } from "../../src/mocks/MockUSD.sol";
import { AssetRegistry } from "../../src/registry/AssetRegistry.sol";
import { AssetFactory } from "../../src/factory/AssetFactory.sol";
import { AssetVault } from "../../src/vault/AssetVault.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";

/// @notice Drives every inflow a half-built system's vault exposes, holding the roles that would
///         normally authorize them.
/// @dev    The prober is deliberately the asset's registry issuer, the phase-1 initiator (so it is
///         the vault's immutable `issuer`) and the configured `revenueDepositor`. Every attempt it
///         makes therefore passes the role and issuer checks, and the ONLY thing left to stop it
///         is the D-033 status gate. Without that gate these calls succeed and the invariant fails.
contract PendingSystemProber {
    AssetRegistry private immutable registry;
    AssetFactory private immutable factory;
    MockUSD private immutable musd;

    bytes32 public assetId;
    AssetVault public vault;

    constructor(AssetRegistry registry_, AssetFactory factory_, MockUSD musd_) {
        registry = registry_;
        factory = factory_;
        musd = musd_;
    }

    function submit(uint64 maturity) external returns (bytes32) {
        assetId = registry.submitAsset(
            "Pending Solar 01",
            "Renewable energy",
            "ipfs://bafy-pending-solar-01",
            keccak256("pending-solar-01"),
            maturity
        );
        return assetId;
    }

    function begin(AssetFactory.DeploymentParams calldata params) external {
        AssetFactory.PendingDeployment memory pending = factory.beginAssetSystem(params);
        vault = AssetVault(pending.vault);
        musd.approve(pending.vault, type(uint256).max);
    }

    function tryDepositInitialReserve(uint96 raw) external {
        uint256 amount = uint256(raw) % 1_000e6 + 1;
        musd.faucet(address(this), amount);
        try vault.depositInitialReserve(amount) { } catch { }
    }

    function tryDepositReserve(uint96 raw) external {
        uint256 amount = uint256(raw) % 1_000e6 + 1;
        musd.faucet(address(this), amount);
        try vault.depositReserve(amount, 1) { } catch { }
    }

    function tryDepositAssetRevenue(uint96 raw) external {
        uint256 amount = uint256(raw) % 1_000e6 + 1;
        musd.faucet(address(this), amount);
        try vault.depositAssetRevenue(amount) { } catch { }
    }
}

/// @notice D-033: between `beginAssetSystem` and `completeAssetSystem` an asset's vault exists but
///         its system does not. Money that reached it there would be unrecoverable — there is no
///         redemption controller, no market manager, and abandoning the deployment renounces the
///         factory's admin. "The vault takes nothing until the system is finished" is a safety
///         property, so it is asserted across randomized sequences rather than in a single unit
///         test.
contract PendingSystemInvariantsTest is StdInvariant, ArcReserveTestBase {
    PendingSystemProber private prober;

    function setUp() public override {
        ArcReserveTestBase.setUp();

        prober = new PendingSystemProber(registry, factory, musd);
        registry.grantRole(registry.ISSUER_ROLE(), address(prober));
        factory.grantRole(factory.ISSUER_ROLE(), address(prober));

        uint64 maturity = uint64(block.timestamp + 3 * 365 days);
        bytes32 id = prober.submit(maturity);
        AssetFactory.DeploymentParams memory params = AssetFactory.DeploymentParams({
            assetId: id,
            tokenName: "Pending Solar 01",
            tokenSymbol: "PSOL01",
            maximumSupply: 100_000e18,
            minimumReserveRatioBps: 2_000,
            offeringStartsAt: uint64(block.timestamp),
            offeringEndsAt: uint64(block.timestamp + 30 days),
            tokenPrice: 1e6,
            fundraisingCap: 80_000e6,
            walletPurchaseLimit: 50_000e6,
            offeringInventory: 80_000e18,
            minimumPurchase: 1e6,
            redemptionPeriodDuration: 1 days,
            redemptionPeriodLimitTokens: 25_000e18,
            // Both point at the prober so it genuinely holds the roles phase 1 hands out.
            operator: address(prober),
            revenueDepositor: address(prober),
            poolFactory: address(poolFactory),
            poolFee: 3_000,
            initialSqrtPriceX96: uint160(1 << 96),
            identityRegistry: address(identityRegistry)
        });
        registry.approveAsset(id, 1e6, keccak256(abi.encode(params)));
        prober.begin(params);

        // Only the inflow attempts are fuzzed. `submit` and `begin` would move the fixture itself.
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = PendingSystemProber.tryDepositInitialReserve.selector;
        selectors[1] = PendingSystemProber.tryDepositReserve.selector;
        selectors[2] = PendingSystemProber.tryDepositAssetRevenue.selector;
        targetSelector(FuzzSelector({ addr: address(prober), selectors: selectors }));
        targetContract(address(prober));
    }

    /// @notice The core property: nothing accumulates in a vault whose system was never finished.
    function invariantPendingVaultNeverTakesValue() public view {
        AssetVault pendingVault = prober.vault();
        assertEq(pendingVault.totalStablecoinBalance(), 0, "pending vault received funds");
        assertEq(pendingVault.totalAccounted(), 0, "pending vault booked an allocation");
        assertEq(pendingVault.redemptionReserve(), 0);
        assertEq(pendingVault.assetRevenue(), 0);
    }

    /// @notice The precondition the property above depends on: the asset really is still in the
    ///         unfinished window, so the invariant is not passing vacuously.
    function invariantPendingSystemStaysUnfinished() public view {
        assertEq(
            uint8(registry.statusOf(prober.assetId())),
            uint8(IAssetRegistry.AssetStatus.Approved),
            "asset left the Approved window"
        );
        assertTrue(factory.isPending(prober.assetId()), "pending record disappeared");
    }
}
