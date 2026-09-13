# Testing and Verification Guide

Status: baselines updated 2026-09-05; suite map below predates tasks 1-10 and is being reworked.

## 1. Baseline

The last full Foundry run (2026-09-12, `main` after D-039) completed with:

```text
330 tests passed
0 failed
0 skipped
```

That is the default profile, which excludes `test/fork/**`. The 9 fork tests run separately and
need `BASE_SEPOLIA_RPC_URL`: `FOUNDRY_PROFILE=fork forge test`.

### Three rungs of pool fidelity

Market tests run against one of three pools, and the distinction matters when reading a result:

| Rung | Pool | Needs network | What it can prove |
| --- | --- | --- | --- |
| `MockUniswapV3Pool` | callback harness | no | control flow, roles, accounting, events |
| `test/local/**` | **real v3-core, deployed locally** | **no** | everything the mock cannot: `L` math, range/token asymmetry, tick crossing, fee accrual, the flywheel |
| `test/fork/**` | canonical pool on Base Sepolia | yes (RPC) | the above, plus the real chain's own pool state and factory |

The mock is a harness, not an AMM: no curve, no tick crossing, no fee growth, and `mint` charges
`liquidity × 1` on both sides regardless of range. It therefore **cannot** produce the inventory
conversion that creates flywheel surplus — on the mock the engine correctly reports
`FlywheelSkipped("NO_SURPLUS")` forever, which is right behaviour and no evidence at all.

`test/local/**` closes that gap without a network. It deploys the canonical `UniswapV3Factory`
from bytecode vendored at `test/artifacts/UniswapV3Factory.json` (v3-core 1.0.1 npm; its pool init
code hash is the mainnet constant `0xe34f199b…`), so it is the same AMM, and it runs in the default
`forge test`. It reproduces the fork's numbers exactly — reserve 24,000.000000 → 24,630.323486 and
backing 0.300000 → 0.307879 on the flywheel, and identical mint amounts on all three ranges —
which is the evidence that the two rungs agree.

**Why ArcReserve can deploy V3 locally when most integrations cannot:** the usual blocker is
`PoolAddress.POOL_INIT_CODE_HASH`, a constant periphery hardcodes that breaks whenever core is
recompiled. ArcReserve never uses periphery — `AssetFactory` calls `factory.getPool()` /
`createPool()` and the manager drives the pool through mint/burn/collect/swap callbacks — so no
init-code-hash constant is anywhere in the path.

The fork suite is still worth keeping: it is the only rung that exercises the actual chain. But it
is no longer the only place real Uniswap behaviour is covered, and after its first run Foundry
serves it from the pinned-block RPC cache, so it re-verifies the contracts rather than the network
unless you clear `~/.foundry/cache/rpc`.

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

### Fork tests (canonical Uniswap V3)

Everything above runs against `MockUniswapV3Pool`. The fork suite runs the engine against the
**real** Uniswap V3 on a pinned Base Sepolia block, and is **excluded from `forge test`** (see
`no_match_path` in `foundry.toml`) because it hits an RPC:

```bash
FOUNDRY_PROFILE=fork forge test -vv      # needs BASE_SEPOLIA_RPC_URL
```

The block is pinned (46,710,000), so after the first run Foundry serves it from cache and the suite
takes well under a second. Do not unpin it: results would drift with chain state.

Two things to keep in mind when reading a green fork run:

- It proves liquidity math, fee accrual and callback behaviour against real v3 code.
- It proves **nothing about transaction admissibility.** A fork does not enforce EIP-7825's
  per-transaction gas cap or Hedera's, which is how an 18.4M-gas `deployAssetSystem` passed every
  fork rehearsal before being refused at precheck on the real chain.

## 3. Suite inventory

| Suite | Tests | Main coverage |
| --- | ---: | --- |
| `AssetRegistryTest` | 4 | Submission/approval, unauthorized verifier, NAV bounds/staleness, suspension |
| `AssetTokenAndVaultTest` | 6 | Cap/permit, roles/pause, 70/20/10, protected reserve, market allocation, reentrancy |
| `ComplianceGateTest` | 18 | Identity gate on buy/transfer, expiry and deletion, pool as exempt infrastructure, freeze/partial freeze/forced transfer, `transferRestriction` preview, modular compliance binding, country and resale-lock modules |
| `AssetMarketManagerTest` | 8 | Price sources, base liquidity lifecycle, callbacks, deadlines/slippage, cooldown, and the D-039 inversions: staleness and spot/NAV divergence do **not** stop rebalancing, and codes 4/5/6 are never returned |
| `AssetMarketManagerControlsTest` | 17 | Roles, configuration, funding round trip, pause recovery, failures, rebalances, swaps, safety policy/state |
| `OfferingRevenueRedemptionTest` | 9 | Offering limits, transfer-aware revenue, vesting exclusion, reserve growth, redemption modes/limits |
| `MockUSDAndDecimalMathTest` | 4 | Six decimals, conversions, rounding, fuzz conversion bound |
| `ArcReserveLifecycleIntegrationTest` | 3 | Complete lifecycle, default/emergency path, full holder redemption |
| `MarketMakingHappyPathTest` | 3 | Hikari-inspired slide, sweep, discovery refresh and remint |
| `FinancialInvariantsTest` | 5 | Supply, accounting/solvency, claims, reserve, obligation equality |
| `MarketFlywheelTest` | 10 | D-035 accounting and authority: `principalOutstanding` as cost basis, `creditableSurplus` cap (borrowed capital is never creditable, an under-water manager reads 0), market-manager-only crossing (not keeper, not admin), that the crossing is one-way, and (D-039) that the public `swapExactInput` path and the crank behind it run under a stale NAV |
| `MarketSignalAndFloorLevelUpTest` | 14 | The D-036 anchor-range signal proven under **both** token orderings, the opportunistic floor level-up including a hostile controller on both try/catch arms, and the D-039 NAV-independence set — full engine cycle under a two-day-stale NAV, plus the inversion of D-038's containment test |
| `LocalUniswapV3MarketTest` | 9 | **Real v3-core, deployed locally, no RPC.** Pool identity (factory fee-tier table, canonical bytecode sizes); range/token asymmetry across all three positions; a genuine swap driving the D-036 anchor signal; fee accrual and collection; **the D-035 flywheel end to end**; the unspent-input refund; and D-039 NAV independence re-proven where the liquidity math is real |
| `BaseSepoliaMarketForkTest` | 9 | **Fork, canonical Uniswap V3.** Real pool identity; range/token asymmetry (below-spot ranges need stable only, above-spot need asset only, straddling needs both); a genuine swap driving the D-036 anchor signal; fee accrual and collection on live and emptied positions; **the D-035 flywheel end to end** — trade in, surplus credited, backing up, floor ratcheted — and the unspent-input refund |

Total: 330 in the default profile (2026-09-12), plus 9 fork tests under `FOUNDRY_PROFILE=fork`. The table
above lists only a subset — see `contracts/test/` for the compliance, schedule, floor, terms,
class-cap, residual-reserve and two-phase-deployment suites added since.
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
- inactive, matured, and insolvent states;
- configured/no-accrual fee collection; and
- **NAV independence (D-039)**: the full keeper cycle and the public `swapExactInput` path both run
  under a two-day-stale NAV, and codes 4, 5 and 6 are asserted never to be returned — under a stale
  NAV and under a spot price far from it. These assert an *absence* of behaviour, which is exactly
  the kind that erodes silently; `test_addLiquidityIsNoLongerNavGated` checks the liquidity actually
  lands rather than only that the call did not revert.

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

Last verified on 2026-09-13, after `openspec/changes/launchpad-portal` (D-040) added the portal:

- TypeScript `tsc -b` (app, node and e2e project references): passed;
- ESLint 10 (flat config, mirrors the backend's): passed;
- Vitest: 116 tests across 25 files, all passed;
- Playwright: 30 cases across 3 viewport projects (28 passed, 2 correctly skipped where not
  applicable — see below); and
- Vite production build: passed (`dist/` bundle emitted; one >500 kB chunk-size warning, not a
  failure).

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
than merely being styled as if it would. It runs against **system Chrome** (`channel: "chrome"`) on
port **4318**: on this machine a Windows Application Control policy blocks the Playwright-downloaded
browsers under `%LOCALAPPDATA%\ms-playwright`, and Docker already holds the app's 3000. The suite is
hermetic — `VITE_API_URL` is unset, so the portal renders from `lib/fixtures.ts` with every panel
labelled `mock`. These are standard CSS layout assertions, not engine-specific rendering, so testing
one engine is a scope choice, not a gap. There is no CI in this repository, so `npm run test:e2e` is
a local command run by habit, not a gate anything enforces automatically.

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
| `src/lib/queries.test.tsx` | Chain-aware client (INTEGRATION_GUIDE §2.1) — every request carries `chainId`, and a response naming another chain throws `CHAIN_MISMATCH` |
| `src/components/data-source.test.tsx` | Field provenance overrides the envelope; `asOf: null` is "not indexed" for a live read but not for a fixture; error codes map to distinct messages |
| `src/lib/safety.test.ts` | `SafetyFailure` indices 0–8 in order; 4/5/6 present and marked reserved so 7/8 do not shift |
| `src/lib/ticks.test.ts` | Tick↔price round-trips under both `assetIsToken0` orderings; `t` and `-t` give the same human price |
| `src/lib/swap.test.ts` | Swap summary uses the input token's decimals; the refund is shown only when `amountRequested > amountSpent` |
| `src/lib/null-values.test.ts` | Null renders a dash, never `0`; a real zero still renders zero |
| `src/portal-claims.test.ts` | The portal source (comments stripped) carries no forbidden claim and does state the honest disclaimer |
| `src/lib/contract-shapes.test.ts` | Typed response fixtures for the portal routes, so a backend shape change fails `tsc`; asserts no `twap` field |
| `e2e/responsive.spec.ts` | Real-browser layout at phone/tablet/desktop — landing page (see above) |
| `e2e/portal-responsive.spec.ts` | Real-browser layout for `/offerings` and `/assets/:slug` — no horizontal overflow, disclosure nav reachable below `lg`, chain switch reachable and route-reflecting, chart contained, header controls within the viewport |

One bug the tests themselves caught, worth keeping in mind when writing the next claim-rule check: a
first draft of `App.test.tsx`'s "no guarantee language" check searched the *entire* rendered page,
which failed against `LandingFooter`'s own required disclaimer — "not a guaranteed return" is
truthful, mandated content, not a claim. Fixed by scoping the check to `<main>` (Hero through
ClosingCta); a blunt whole-page string search over-corrects when the required disclaimer legitimately
uses the same word to deny something rather than assert it.

Closed by `launchpad-portal` (D-040) — the SOLAR01 deep-dive has landed. The list below is what it
added coverage for: transaction state machines (submitted →
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

## 14. Portal demo checklist (launchpad-portal, D-040)

Run manually before a demo, on both chains. This is the plan §E.4 script; it needs a wallet and a
live backend, so it is run by the owner, not by the automated gate.

Per chain (Hedera 296, then Arc 5042002), with a fresh wallet:

1. Connect the wallet; switch the portal to the chain under test (default Hedera).
2. `Get mUSD` (faucet) -> confirm `FaucetUsed`.
3. `Verify me` -> confirm `IdentityRegistry.isVerified` reads true afterwards.
4. Subscribe (buy SOLAR01) -> confirm `TokensPurchased`.
5. Swap mUSD -> SOLAR01, then SOLAR01 -> mUSD (buy <= ~10 mUSD, sell <= ~5 SOLAR01) -> confirm
   `SwapExactInput`, the `amountSpent` shown, and any refund.
6. Claim revenue -> confirm `RevenueClaimed` (or `NoRevenueToClaim`).
7. Redeem -> confirm `Redeemed`; the price is `min(NAV, backing)`, not the published floor.

Also verify the failure states:

- wrong-chain wallet: the write is disabled and offers a switch;
- unverified wallet: buy and swap block with the verification reason;
- disconnected wallet: actions are disabled with "connect" guidance;
- API down: an error state, never a fixture;
- `/v1/health` degraded: the banner appears and data still serves.

Liquidity is thin (about 135 mUSD of buys and 176 mUSD of sells per re-arm, with one flywheel turn
per re-arm); after a large buy, re-arm with the keeper's `removeLiquidity(Anchor)` plus `ArmMarket`
before the next demo. See `docs-handover/PRODUCT_KNOWLEDGE.md` §7.7.

Automated status: the journey's units and layout are covered by Vitest and Playwright; the live
wallet steps above have **not** been executed as part of this change and remain the owner's manual
run.
