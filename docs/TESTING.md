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
npm run test
npm run test:e2e
npm run build
```

On Windows systems where PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Last verified on 2026-09-12, after `openspec/changes/concept-landing-page` (D-036) landed on top of
the D-035 Vite rebuild:

- TypeScript `tsc -b` (now three project references — app, node, and e2e; see below): passed;
- ESLint 10 (flat config, mirrors the backend's): passed;
- Vitest: 83 tests across 17 files, all passed;
- Playwright: 12 cases across 3 viewport projects, all passed (2 correctly skipped where not
  applicable — see below); and
- Vite production build: passed (`dist/` bundle emitted).

### Two runners, because they can prove different things

**Vitest + Testing Library (jsdom)**, configured in `vite.config.ts` with `vitest.setup.ts`, covers
unit behaviour: component logic, formatting, provenance rules, and the page's claim rules (no audit
vocabulary, no guarantee language, no "live" self-description) checked by rendering and searching
text. It cannot prove layout at all — jsdom has no CSS cascade and no layout engine, so a `lg:flex`
breakpoint class never actually computes and `getBoundingClientRect()` returns zeros.

**Playwright + Chromium**, configured in `playwright.config.ts` with its own `tsconfig.e2e.json`
(Playwright's `page.evaluate()` callbacks run inside the real browser and need DOM lib types the
Node-only `tsconfig.node.json` does not carry), covers what only a real browser can: no horizontal
document overflow, navigation actually hiding/showing at the right pixel widths, and wide content
(a five-column table) genuinely needing to scroll inside its own container at phone width rather
than merely being styled as if it would. Chromium only — these are standard CSS layout assertions,
not engine-specific rendering, so testing one engine is a scope choice, not a gap. There is no CI in
this repository, so `npm run test:e2e` is a local command run by habit, not a gate anything enforces
automatically.

Two of the twelve Playwright cases are intentionally skipped outside the `phone` project via
`test.skip(condition, reason)`: the five-column reference table needs to scroll at 390px but not
necessarily at 768px or 1440px, so asserting it must scroll everywhere would be asserting something
false about wider viewports.

### Coverage, current file by file

| File | Covers |
| --- | --- |
| `src/lib/format.test.ts` | Money display — truncation never rounds up, thousand grouping, price padding to three decimals, compact abbreviation, basis points, absent-vs-zero (`—` vs `0.000`) |
| `src/lib/api.test.ts` | D-019 — fixture mode is configured not fallback, no network call in fixture mode, backend error codes surfaced, a non-envelope response rejected, an unreachable backend reported as `NETWORK`, fixture envelopes labelled `mock` + `stale` |
| `src/hooks/use-reduced-motion.test.ts` | Reads the live OS preference via a stubbed `matchMedia`, updates without a remount, defaults to motion-allowed when `matchMedia` does not exist |
| `src/components/landing/concept-banner.test.tsx` | The persistent statement names what the page is and is not, and exposes no dismiss control |
| `src/components/landing/concept-marker.test.tsx` | The "this figure is invented" marker renders and is distinguishable from `DataSourceBadge` |
| `src/components/landing/arc-monogram.test.tsx` | The logo is a local, labelled, self-contained SVG with no external reference |
| `src/components/landing/landing-header.test.tsx` | Every nav link is an in-page anchor; the mobile disclosure opens, lists links, and closes on activation |
| `src/components/landing/landing-footer.test.tsx` | Restates the accurate disclaimer, not the Stitch reference's colophon claims |
| `src/components/landing/scroll-reveal.test.tsx` | Fails open (already revealed) under reduced motion and when `IntersectionObserver` does not exist; reveals correctly once one is available and fires |
| `src/components/landing/shader-background.test.tsx` | Full lifecycle with a fake WebGL context and fake observers — no loop until intersecting, loop starts, context lost stops it; reduced motion mounts no canvas at all; missing WebGL context falls back to the static background |
| `src/components/landing/hero.test.tsx` | Product tagline, no production/guarantee claims, the status pill carries a concept marker, both CTAs are in-page anchors |
| `src/components/landing/telemetry-band.test.tsx` | No "live" self-description, no audit vocabulary, no "fixed" split claim, all four cards carry a concept marker |
| `src/components/landing/dual-participant-engine.test.tsx` | No unconditional/instant exit claim, no audit or invented regulatory framework, no dangling links |
| `src/components/landing/value-references.test.tsx` | The five references stay five distinct, separately labelled entries; no "instant redemption", no named third-party attestation, no "guarantee" |
| `src/components/landing/safety-ladder.test.tsx` | All four stages render in their real order; no guarantee language or invented jurisdiction *at any selected stage* (checked by clicking through all four, since only one stage's detail panel is in the DOM at a time); the real 40/45/10/5 split figures, not the reference's invented 85/15 |
| `src/components/landing/closing-cta.test.tsx` | No audit claim, no misstatement of who may participate, both CTAs resolve to real in-page sections |
| `src/App.test.tsx` | Page-level: claim rules hold across every section at once (not just within one), the concept statement sits inside the shared sticky wrapper, exactly six concept markers exist across the whole page, all six sections render in their documented order with every nav href resolving to a real section id, no animation frame loop starts without WebGL, and mounting the page issues no backend request at all |
| `e2e/responsive.spec.ts` | Real-browser layout at phone/tablet/desktop — see above |

One bug the tests themselves caught, worth keeping in mind when writing the next claim-rule check: a
first draft of `App.test.tsx`'s "no guarantee language" check searched the *entire* rendered page,
which failed against `LandingFooter`'s own required disclaimer — "not a guaranteed return" is
truthful, mandated content, not a claim. Fixed by scoping the check to `<main>` (Hero through
ClosingCta); a blunt whole-page string search over-corrects when the required disclaimer legitimately
uses the same word to deny something rather than assert it.

Gaps worth closing once the deferred SOLAR01 deep-dive lands: transaction state machines (submitted →
receipt confirmed), stale and error rendering per panel, and tick↔price conversion under both token
orderings.

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
