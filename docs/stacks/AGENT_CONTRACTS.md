# Agent brief — Contracts (Solidity / Foundry)

You own `contracts/`. Read `CLAUDE.md`, then `docs/SYSTEM_SPEC.md`, `docs/MARKET_MAKING.md`,
`docs/TESTING.md`, `docs/SECURITY.md`. Complete `docs/AI_COMPREHENSION_CHECK.md` before material
changes.

## You own
- `contracts/src/**`, `contracts/test/**`, `contracts/script/**`, `contracts/foundry.toml`
- `contracts/deployments/*.json` (regenerated, never hand-edited)
- Boundary docs when you change an interface: `CONTRACTS_TO_FRONTEND.md`, `CONTRACTS_TO_BACKEND.md`

## You do not touch
- `frontend/**`, `backend/**`. If they need a new view or event, add it here and announce it in
  the boundary doc; do not edit their code.

## Non-negotiables (from `CLAUDE.md`)
Capped supply; market manager cannot mint; reserve ≠ market inventory; NAV/spot/TWAP/floor/
redemption are distinct; redemption reserve-limited; burn before pay; yield-eligible supply excludes
vesting; price appreciation is not profit; no Hikari minting/bonding curve.

## Commands
```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe build
C:\Users\willi\.foundry\bin\forge.exe test
C:\Users\willi\.foundry\bin\forge.exe coverage --report summary
C:\Users\willi\.foundry\bin\forge.exe fmt --check
anvil   # separate terminal
C:\Users\willi\.foundry\bin\forge.exe script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
```
Baseline: 247 passed / 0 failed / 0 skipped; 7 invariants; `forge fmt --check` clean
(2026-08-30, after task 10 — **all ten tasks complete**). Note `via_ir = false` and it stays that way — fix stack-too-deep by
extracting a helper, not by turning on the IR pipeline.

## Interface stability rules
- Do not rename or re-order enum members (`AssetStatus`, `RedemptionMode`, `PositionKind`,
  `SafetyFailure`) — both consumers hardcode the integers.
- Do not change event parameter lists without a `CHANGED` row in `CONTRACTS_TO_BACKEND.md`.
- Do not change function signatures listed in `CONTRACTS_TO_FRONTEND.md` §3 without a `CHANGED` row.
- Keep 6d/18d conventions; never introduce an 8d or 1e18-priced value.
- `deployments/<chainId>.json` key names are an interface; adding keys is fine, renaming is not.
- **Public view names are an interface too.** Since the backend's read API serves live calls at the
  indexed block, renaming a view breaks it exactly as hard as changing an event. The surface it
  depends on is listed in `CONTRACTS_TO_BACKEND.md` §9 — a `CHANGED` row before any rename.

## Scope (D-027)
Hackathon only. Targets: Anvil, **Base Sepolia (84532)**, **Hedera testnet (296)**. `MockUSD` on
all three; no mainnet, no audit claims. Deliverables include `deployments/84532.json` and
`deployments/296.json`, a chain-aware deploy script (`block.chainid`), a verified Uniswap V3
factory address on Base Sepolia (or the mock pool), the mock pool on Hedera unless a V3-compatible
factory is verified, and an `evm_version` both chains support (verify Hedera's EVM version first).
Testnet keys only via untracked `.env`.

## Baseline (2026-08-27)
The compliance layer (D-021) is merged: 75 tests, `src/compliance/`, permissioned `AssetToken`.
`deployments/31337.json` is regenerated. Read D-021 before touching the token.

Task 1 (D-024, company-token treatment) is merged: 97 tests, `test/unit/IssuerAllocation.t.sol`,
`AssetToken.setIssuerAllocation` / `investorSupply()`, and the vault / redemption denominators.

**D-031 (2026-08-30) then removed the issuer token allocation entirely.** Nothing sets the
`issuerAllocation` flag in the demo, so `investorSupply == totalSupply`; the machinery is retained
as a guard. This resolved the D-024/D-025 conflict — task 7 is unblocked, but `levelUp()` must
still re-check `price(level) <= min(NAV, backing)` on every call rather than trusting a cached level.

## First tasks (in order) — business-model alignment, D-022 / D-023 / D-024
1. ~~**Company-token treatment (D-024).**~~ **DONE 2026-08-27.** `issuerAllocation` flag on the token;
   `RedemptionController.redeem` reverts for flagged holders; `investorSupply()` view; switch
   `redemptionPrice`, `minimumRequiredReserve`, `reserveRatioBps` to the investor-supply
   denominator. Tests: flagged holder cannot redeem in any mode; denominators exclude it.
2. ~~**Reserve schedule + enforcement (D-023).**~~ **DONE 2026-08-30.** New `ReserveSchedule` state on the vault
   `(startBacking, targetBacking, startTime, maturity, graceSeconds)`; `targetBacking(t)`,
   `currentBacking()`, `isBehindSchedule()`, `shortfallSince`; `depositReserve(amount, periodId)`
   for the issuer; gate `withdrawIssuerProceeds` (and future issuance) on not-in-shortfall past
   grace. Events: `ReserveScheduleSet`, `ReserveContribution`, `ReserveShortfallEntered/Cleared`.
   Invariant: backing never decreases through a redemption.
3. ~~**Dynamic revenue split (D-023) + period tagging (D-022).**~~ **DONE 2026-08-30.** `RevenueDistributor` splits become
   admin-settable within bounds with a `behindSchedule` variant (40/45/10/5); `depositRevenue(amount,
   periodId, reportHash)` emits the period; missing period past grace is reported via a view.
4. ~~**Reserve yield hook (D-023).**~~ **DONE 2026-08-30.** `accrueReserveYield(amount)` (yield-source role) credits the
   reserve while behind schedule, else `issuerProceeds`. Mock yield source in `DeployLocal`.
5. ~~**Residual return (D-023).**~~ **DONE 2026-08-30.** `releaseResidualReserve()` callable at `Closed` after the maturity
   window; pays `reserve − outstandingObligations` to the issuer. Add the maturity window to the
   redemption controller.
6. ~~**Settlement split 65/30/5 (D-023).**~~ **DONE 2026-08-30 — D-023 complete.** Change `PrimaryOffering` bps constants; update tests and
   docs. Escrow/threshold settlement (D-007) remains the next milestone after 1–7.
7. ~~**Floor level-up (D-025).**~~ **DONE 2026-08-30.** A small `FloorController` (reads vault, registry NAV, pool
   `tickSpacing`, manager `assetIsToken0`): `floorTick`, `floorPrice()` via `TickPriceMath`,
   `floorLevelCooldown`, permissionless `levelUp()` advancing **one `tickSpacing`** per call in the
   price-up direction iff `price(next) ≤ min(NAV, backing)`; event `FloorLevelUp`. Optional best-
   effort `levelUp` attempts from reserve-crediting paths. `AssetMarketManager.rebalanceToFloor
   (lower, upper)` requiring `upper ≤ floorTick` (price terms) and passing the normal safety gates.
   Invariants: `floorPrice ≤ min(NAV, backing)` always; `floorTick` never moves down in price
   while Active; backing never decreases through a redemption; at most one step per cooldown.
8. ~~**Term-sheet binding (D-026).**~~ **DONE 2026-08-30.** `approveAsset(assetId, initialNAV, termsHash)` +
   `reapproveTerms`; registry stores/exposes `termsHashOf(assetId)`; factory checks
   `keccak256(abi.encode(params))` and reverts `TermsMismatch()`. Emit `TermsApproved(assetId,
   termsHash)`. Update `DeployLocal`, `ArcReserveTestBase`, and the `CHANGED` rows (frontend
   `approveAsset`/verifier UI and backend event catalog both change).
9. ~~**Class-based purchase caps (D-028).**~~ **DONE 2026-08-30.** `PrimaryOffering.walletPurchaseLimitByClass(uint8)`
   (admin-settable, default = `walletPurchaseLimit`), read `investorClass` from the token's
   registry on `buy`; optional per-class aggregate cap; event `ClassLimitSet`. Demo: retail
   5,000 / accredited 50,000 / institutional uncapped. Tests per class + fallback.
10. Then: `DEMO_SEED_LIQUIDITY` option for non-zero positions; **synthetic OHLC — decided
   2026-08-30: `MockUniswapV3Pool` moves `sqrtPriceX96` and emits a canonical `Swap`**, so the
   canonical ingestion path is exercised on Anvil rather than first meeting reality on Base
   Sepolia (backend agent's argument; the alternative leaves that path untested until testnet).
   Two requirements from the consumer: emit `Initialize` at pool setup so the first price can be
   seeded, and keep `Swap` args in canonical order `(amount0, amount1, sqrtPriceX96, liquidity,
   tick)`. The mock still models no price impact, tick crossing, fee growth or liquidity
   exhaustion, so candles are "derived from a labelled demo AMM", never price discovery, and stay
   mock-badged in the UI. Then: factory role-renounce decision.

Every step: update `docs/SYSTEM_SPEC.md`, `docs/BUSINESS_MODEL.md` "current vs target" table, and
the `CHANGED` rows in `CONTRACTS_TO_FRONTEND.md` / `CONTRACTS_TO_BACKEND.md`.

## Definition of done for any change
`forge test` green, invariants unchanged or extended, `forge fmt --check` clean, coverage not
lower for touched files, boundary doc updated, `docs/SYSTEM_SPEC.md` updated if a formula changed.

## Hand-off artifact
A message to the other agents containing: changed signatures/events, new `deployments/31337.json`,
and the `CHANGED` rows you added.

## To-do: the market flywheel (D-035) — core feature, not yet built

Recorded 2026-09-12 from the owner's design session. Build order matters; the cheap half can ship
with the TWAP redeploy, the expensive half should not be rushed into it.

**Phase A — rides with the TWAP redeploy (deletions and small additions, mock-testable):**
1. Remove TWAP (D-036). `marketPrices()` keeps its 3-tuple but returns **0** in the twap slot —
   never spot, which would publish a real number under a false label. Remove `twapWindow()` too.
   The 3-tuple shape itself is pinned in both boundary
   docs. Re-signal `slide`/`sweep` from **NAV** (slide when spot > NAV, sweep when spot < NAV),
   otherwise they are the same function with different labels.
2. `SafetyFailure.SpotTwapDeviation` **stays at value 5, reserved and never returned.** Deleting it
   shifts `MarketNAVDeviation`/`ReserveBelowMinimum`/`Cooldown` down one and both stacks silently
   mislabel every failure.
3. `maxMarketNAVDeviationBps` now compares **spot** to NAV — the only market guard left, and more
   sensitive than before. `twapWindow` and `maxSpotTwapDeviationBps` become dead; changing
   `setSafetyPolicy`'s signature is cheap (only tests call it) but must be deliberate.
4. Opportunistic `levelUp()` on the rebalance path — skip silently if `canLevelUp()` is false or the
   controller is unset; never revert the caller.
5. Deploy scripts drop the three stepped `increaseObservationCardinalityNext` calls.
6. `DeployLocal` keeps its `require(block.chainid == 31337)` guard.
7. **Rebalance cooldown is configured to 1 second** (owner, 2026-09-12).
   ~~Drop the `cooldown_ == 0` clause from the guard.~~ **Withdrawn 2026-09-12** — the guard rejects
   only zero, and 1 already passes, so removing it would weaken a check to enable something that
   already works. Leave the zero-rejection in place. Reason for 1s: at 1s, two rebalances in the same block still
   trip `SafetyCheckFailed(Cooldown)` (`block.timestamp < lastRebalanceAt + 1` holds when equal),
   so the refusal stays demonstrable — it is one of the very few guards that bites instantly on a
   public chain, with no time-warping — while a demo sequence one second apart runs freely. Setting
   0 would buy the same speed and throw the demo away.
   The **floor** level-up cooldown needs no code: `setFloorLevelCooldown` already accepts zero and
   the owner holds admin on the live controller, so it is a configuration call on the deployed
   contract.

**Phase B — the flywheel proper (needs new math and new test infrastructure):**
7. `AssetVault.creditMarketSurplus(uint256)` — market-manager only, one-way, realised surplus only.
   See D-035 for why each property is load-bearing.
8. Atomic `slide`/`sweep`: burn → collect → move ticks → re-mint in one transaction; anchor never
   observably empty; triggerable from `executeSwap`.
9. `LiquidityAmounts` / `SqrtPriceMath` (or equivalent) to compute `L'` from recovered amounts at the
   new range. The repo has only `TickPriceMath.getSqrtRatioAtTick` today.
10. Anchor top-up from idle inventory, degrading to single-sided when inventory is exhausted;
    `RebalanceSkipped(reason)` on every skip path.
11. Discovery proceeds routed to the protected reserve via (7), closing the loop into `levelUp()` and
    the existing `rebalanceToFloor`.
12. **Uniswap V3 fork tests.** Non-negotiable for phase B: the mock pool's `amount = liquidity ×
    constant` cannot validate `L'`, and wrong liquidity math under-deploys capital silently instead
    of reverting. This is the repo's first fork test and is the real cost of the feature.

**Explicitly out of scope** (owner, D-035): timelocks, multisig, approval delays, maker-checker.
Existing role gates stay — they are free, already built, and are themselves demo material.

**Known sequencing traps:** a redeploy creates a new `IdentityRegistry`, so `DemoRegistrar` must be
deployed after it and against it; token ordering may flip again and both stacks must re-read
`assetIsToken0()`; backend `START_BLOCK` and both running API instances need repointing;
`SECURITY.md`'s risk register names the spot/TWAP gate as *the* spot-manipulation mitigation and must
be rewritten rather than quietly become false.
