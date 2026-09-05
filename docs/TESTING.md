# Testing and Verification Guide

Status: baselines updated 2026-09-05; suite map below predates tasks 1-10 and is being reworked.

## 1. Baseline

The last full Foundry run (2026-09-05, `main` at task 10) completed with:

```text
247 tests passed
0 failed
0 skipped
```

Backend: its own suite (unit + real-PostgreSQL integration + replay/reorg) is green per
`backend/README.md` and the Milestone E entry in `docs/stacks/HANDOFF_LOG.md`; run it with
`cd backend && npm run test`. The frontend still has no test runner.

Coverage summary:

| Scope | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `AssetMarketManager.sol` | 98.17% (215/219) | 95.50% (297/311) | 73.91% (34/46) | 100% (28/28) |
| Overall Solidity sources (2026-08-27) | 80.91% (1089/1346) | 80.50% (1371/1703) | 50.42% (119/236) | 79.28% (176/222) |
| `AssetToken.sol` (2026-08-27) | 95.65% (110/115) | 91.50% (140/153) | 75.76% (25/33) | 95.24% (20/21) |
| `IdentityRegistry.sol` | 60.00% (36/60) | 51.61% (32/62) | 12.50% (1/8) | 56.25% (9/16) |
| `ModularCompliance.sol` | 65.45% (36/55) | 58.46% (38/65) | 9.09% (1/11) | 69.23% (9/13) |

Foundry coverage disables normal optimizer/via-IR settings for instrumentation and may print source
anchor warnings. Treat percentages as directional evidence, not an audit or formal proof.

## 2. Commands

From `contracts/`:

```powershell
C:\Users\willi\.foundry\bin\forge.exe build
C:\Users\willi\.foundry\bin\forge.exe test
C:\Users\willi\.foundry\bin\forge.exe test -vv
C:\Users\willi\.foundry\bin\forge.exe coverage --report summary
```

When Foundry is on `PATH`:

```bash
forge build
forge test
forge coverage --report summary
```

Focused market runs:

```bash
forge test --match-contract AssetMarketManagerTest
forge test --match-contract AssetMarketManagerControlsTest
forge test --match-contract MarketMakingHappyPathTest
```

Useful failure diagnostics:

```bash
forge test --match-test testName -vvvv
forge test --rerun -vvvv
```

## 3. Suite inventory

| Suite | Tests | Main coverage |
| --- | ---: | --- |
| `AssetRegistryTest` | 4 | Submission/approval, unauthorized verifier, NAV bounds/staleness, suspension |
| `AssetTokenAndVaultTest` | 6 | Cap/permit, roles/pause, 70/20/10, protected reserve, market allocation, reentrancy |
| `ComplianceGateTest` | 18 | Identity gate on buy/transfer, expiry and deletion, pool as exempt infrastructure, freeze/partial freeze/forced transfer, `transferRestriction` preview, modular compliance binding, country and resale-lock modules |
| `AssetMarketManagerTest` | 6 | Price sources, base liquidity lifecycle, callbacks, deadlines/slippage, stale/deviation, cooldown |
| `AssetMarketManagerControlsTest` | 16 | Roles, configuration, funding round trip, pause recovery, failures, rebalances, swaps, safety policy/state |
| `OfferingRevenueRedemptionTest` | 9 | Offering limits, transfer-aware revenue, vesting exclusion, reserve growth, redemption modes/limits |
| `MockUSDAndDecimalMathTest` | 4 | Six decimals, conversions, rounding, fuzz conversion bound |
| `ArcReserveLifecycleIntegrationTest` | 3 | Complete lifecycle, default/emergency path, full holder redemption |
| `MarketMakingHappyPathTest` | 3 | Hikari-inspired slide, sweep, discovery refresh and remint |
| `FinancialInvariantsTest` | 5 | Supply, accounting/solvency, claims, reserve, obligation equality |

Total: 247 (2026-09-05; the table above lists only the pre-task-1 suites — see `contracts/test/`
for the compliance, schedule, floor, terms, and class-cap suites added since).
Every test in `ArcReserveTestBase` runs against a permissioned token:
`alice`, `bob`, and the test contract are registered in the `IdentityRegistry`; `attacker` is not.

## 4. Shared fixture

`ArcReserveTestBase` creates a fresh isolated system per test:

- timestamp fixed to `1_800_000_000`;
- mUSD, registry, mock pool factory, component deployers, and factory;
- submitted and approved Solar Indonesia 01 record;
- 100,000 maximum supply;
- 80,000 offering inventory and fundraising cap;
- 1 mUSD token/NAV price;
- 20% minimum reserve ratio;
- one-day redemption period and 25,000-token period limit;
- initialized mock pool and one-dollar oracle; and
- 20,000 mUSD initial protected reserve.

Helper `_buy` faucets and approves mUSD, then executes the current direct offering. It is not an
escrow simulation.

## 5. Financial invariants

The stateful handler randomizes revenue deposit, claim, and normal redemption calls. Failed actions
are caught so invariant exploration continues.

Asserted properties:

1. Token supply never exceeds maximum supply.
2. Excluded supply never exceeds issued supply.
3. Eligible circulating supply equals issued minus excluded.
4. Actual vault mUSD is never below accounted categories.
5. The vault remains reserve-solvent.
6. Total claimed holder revenue never exceeds allocated holder revenue.
7. Redemptions never reduce reserve below its required minimum.
8. Redemption outstanding obligations equal token total supply.

The invariant handler does not currently randomize transfers, exclusion changes, market actions,
status changes, or malicious token behavior. Those are unit/integration coverage or future invariant
work.

## 6. Market-making verification

### Happy paths

Each happy path seeds market-floor, anchor, and discovery liquidity, then verifies:

- old range liquidity is fully removed;
- oracle direction is eligible;
- range endpoints update;
- `lastRebalanceAt` updates;
- same liquidity remints into the new range;
- unrelated positions remain funded;
- manager inventory returns to the pre-cycle balance; and
- protected reserve never changes.

The three paths map to Hikari lifecycle concepts only:

- `slide`;
- `sweep`; and
- `drop` -> ArcReserve `refreshDiscovery`.

### Controls and failures

The control suite verifies:

- keeper/admin authorization;
- optional position-kind and tick validation;
- refusal to reconfigure active liquidity;
- exact market allocation withdrawal/return;
- no stale vault allowance after return;
- pause blocks new risk but allows exit;
- add/remove deadline and slippage rollback;
- active liquidity blocks every managed range update;
- slide/sweep direction;
- maximum tick shift and alignment;
- successful `rebalanceToNAV`;
- both swap directions and exact mock accounting;
- zero/expired/input/output swap rejection;
- safety policy bounds;
- inactive, matured, market/NAV-divergent, and insolvent states; and
- configured/no-accrual fee collection.

These tests prove manager control logic against the harness. They do not prove economic behavior of a
real concentrated-liquidity pool.

## 7. Revenue and vesting verification

Tests deploy an OpenZeppelin-based `CompanyVestingWallet`, mark it yield-excluded before funding, and
verify:

- excluded tokens do not enter eligible supply;
- current circulating holders receive the correct revenue share;
- releasing vested tokens reduces excluded supply;
- released tokens participate only in later deposits;
- existing earnings survive a later exclusion change; and
- a deposit reverts when eligible supply is zero.

The test performs vesting wiring manually. Factory-integrated vesting settlement is not yet tested
because it is not implemented.

## 8. Redemption verification

Covered behavior includes:

- burn-before-payment;
- no repeat redemption of burned tokens;
- reserve-backed price cap;
- explicit Normal, Maturity, and Emergency status gates;
- emergency reference setter;
- per-period token limit;
- full holder redemption reducing supply/obligations to zero; and
- continued vault solvency.

Future tests should cover boundary timestamps, multiple-period rollover sequences, emergency price
changes around claims, and large holder sets.

## 9. Mock boundaries

`MockUniswapV3Pool` is intentionally simple:

- mint amount0 and amount1 are deterministic multipliers of liquidity;
- burn returns the same deterministic amounts;
- collect transfers from global pool balances rather than real per-position fee accounting;
- swap output is a fixed basis-point ratio;
- swap does not move price;
- TWAP is a fixed test tick; and
- canonical pool events are absent.

Therefore local tests cannot establish:

- real tick crossing;
- token composition of a V3 position;
- price impact;
- fee growth and principal separation;
- just-in-time liquidity behavior;
- MEV/sandwich resistance;
- liquidity exhaustion; or
- live OHLC derivation.

## 10. Required production-oriented tests

Before public-value deployment, add:

1. Canonical Uniswap V3 fork tests for pool creation, callbacks, mint/burn/collect/swap, token ordering,
   tick math, fee tiers, and price limits.
2. Oracle manipulation simulations over actual observation cardinality/window behavior.
3. MEV and keeper race analysis for explicit remove/update/remint.
4. Reentrancy/malicious-token tests across every external token interaction.
5. Stateful invariants including transfers, exclusions, status changes, pauses, market funding, and
   redemption-period rollover.
6. Differential accounting against an independent model.
7. Gas and deployment-size checks for target chain limits.
8. Escrow/settlement invariants when target fundraising is implemented.
9. Indexer replay, idempotency, and reorg tests.
10. End-to-end browser tests with wallet, wrong chain, rejected signature, and contract revert.

## 11. Frontend validation

From `frontend/`:

```powershell
npm run typecheck
npm run lint
npm run build
```

On Windows systems where PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Last verified on 2026-08-17:

- TypeScript `tsc --noEmit`: passed;
- ESLint: passed;
- Next.js 15.5.9 optimized production build: passed; and
- marketplace, asset detail, engine, issuer, and verifier routes prerendered successfully.

The frontend has no dedicated unit or browser test suite yet. Add tests when live/backend data replaces
fixtures, particularly for unit formatting, provenance labels, transaction state, and stale/error
behavior.

## 12. Formatting note

The new market-control test file passes targeted `forge fmt --check`. At the last repository-wide
check, Foundry still reported pre-existing formatting differences in:

- `src/revenue/RevenueDistributor.sol`;
- `test/invariant/FinancialInvariants.t.sol`; and
- `script/DeployLocal.s.sol`.

Formatting these files should be a separate mechanical change followed by the full suite, so it does
not obscure functional diffs.

## 13. Change-specific verification

| Change | Minimum verification |
| --- | --- |
| Contract logic | Targeted unit test, full suite, relevant invariants |
| Financial allocation | Exact category/balance assertions and rollback case |
| Market manager | Three focused market suites plus full suite |
| Token/revenue hook | Transfer, mint, burn, excluded/non-excluded permutations |
| Deployment wiring | Fresh Anvil deployment and role/address assertions |
| Frontend write | Typecheck, lint, build, wallet receipt and revert path |
| Backend/indexer | Unit, database integration, replay, restart, simulated reorg |
| OHLC | Both token orderings, interval boundaries, exact arithmetic, rollback rebuild |

Do not reduce assertions merely to increase line coverage. Financial state and authorization effects
are the required evidence.
