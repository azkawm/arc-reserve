# Handoff log

The asynchronous channel between the architect session and the stack sessions. **Append only,
newest at the bottom, one dated entry per event.** Use it for: a task completed, an interface
changed (with the `CHANGED` row you added), a decision you need, a blocker, a merge note.

Format:

```text
## YYYY-MM-DD — <stack> — <one-line title>
Branch: <name>   Commit: <sha>
What: ...
Interface changes: <boundary doc + row> | none
Needs: <decision / review / nothing>
```

Rules: never paste chat transcripts; link to files and commits. Decisions requested here are
answered by a D-0xx entry in `docs/DECISIONS.md`, then acknowledged here.

---

## 2026-08-27 — architect — Repository initialised, baseline set
Branch: main   Commit: cc236dc (and later)
What: contracts baseline with compliance layer (75 tests); docs v0.3; stack briefs; prompts.
Interface changes: `CONTRACTS_TO_FRONTEND.md` and `CONTRACTS_TO_BACKEND.md` rows dated 2026-08-27.
Needs: nothing. Stack sessions may start from `docs/stacks/PROMPTS.md`.

## 2026-08-27 — backend — Milestone A complete: workspace, schema, chain guards, /v1/health
Branch: backend/foundation   Commit: (this commit)
What: created `backend/` — validated config (refuses non-testnet chains, zero root addresses,
`CONFIRMATIONS=0` in production), PostgreSQL 16 migrations with `uint256`/`int256`/`eth_*` domains,
chain-integrity tables (`chains`, `indexed_blocks`, `raw_logs`, `indexer_cursors`,
`projection_anomalies`), the four-step startup guard (RPC identity → deployment presence → database
deployment fingerprint → cursor hash, with fresh-Anvil detection per Boundary B §5), `GET /v1/health`,
ABI snapshot script, and 80 passing tests (unit + real-PostgreSQL integration). Verified end to end
against a live Anvil + `DeployLocal` deployment. `npm run typecheck`, `lint`, `build`, `test` green.
Interface changes:
- `BACKEND_TO_FRONTEND.md` §1/§2/§6 — three `CHANGED` rows: nullable `meta.indexedBlockHash` /
  `meta.asOf` before the first indexed block (always `stale: true`); `/v1/health` ships and always
  returns the data envelope (200 healthy/degraded, 503 unhealthy); `?chainId=` reserved on asset routes.
- `BACKEND_INDEXER.md` §5/§6/§17 — envelope `asOf` is unix seconds (was an ISO example); value
  domains, fingerprint columns and `projection_anomalies` documented; Milestone A marked done.
- `DECISIONS.md` — new **D-030** (PostgreSQL 16 + `node-pg-migrate` plain SQL, no ORM; one database,
  `chain_id` everywhere, one indexer process per chain; unconstrained-NUMERIC money domains). Closes
  open item 9.
- `CLAUDE.md` — status rows for Backend API / Chain indexer and the repo map corrected; they claimed
  no `backend/` existed. Architect: please review, this is your file.
Needs: three decisions before Milestone B/C, none blocking B.
1. **Config snapshot reader.** `BACKEND_TO_FRONTEND.md` §3.2 requires `offering.{price, cap,
   walletLimit, minimumPurchase, startsAt, endsAt}`, `supply.maximum`, `minimumReserveRatioBps`,
   `tickSpacing`, `assetIsToken0` and `supply.vesting` — **no event carries any of them**
   (`PrimaryOffering` emits only `TokensPurchased`). I plan a multicall view-snapshot reader at the
   indexed block, refreshed on deployment discovery, labelled `onchain`. Confirm, or the alternative
   is contracts emitting an `OfferingConfigured` event.
2. **Synthetic OHLC ownership** (contracts brief task 10). Preference: `MockUniswapV3Pool` moves
   `sqrtPriceX96` and emits a canonical `Swap`, so Anvil candles are honestly `derived` from a
   labelled demo AMM and the canonical ingestion path is exercised before Base Sepolia. Fallback is a
   backend synthetic adapter behind `ALLOW_MOCK_MARKET_DATA`, which leaves the real path untested.
3. **Ordering against the contracts track.** Milestone C will be built against today's contracts
   (`totalSupply` denominators, 70/20/10, 60/25/10/5). Tasks 1–8 over there change the redemption
   denominator to investor supply, make the splits configurable, and add `ReserveScheduleSet`,
   `ReserveContribution`, `ReserveShortfallEntered/Cleared`, `FloorLevelUp`, `TermsApproved` and
   `ClassLimitSet`. I will add the backing-schedule and floor-level fields as a `CHANGED` row when
   those merge rather than blocking on them. Projections store emitted share values and never
   recompute from hardcoded bps, so a split change needs no backend migration.

## 2026-08-27 — contracts — D-024 company-token treatment implemented (task 1)
Branch: main   Commit: (uncommitted working tree)
What: `AssetToken` gains `setIssuerAllocation(address,bool)`, `isIssuerAllocation`,
`issuerAllocationSupply` (running total maintained in `_update`) and `investorSupply()`.
`AssetVault.minimumRequiredReserve` / `reserveRatioBps`, `RedemptionController.redemptionPrice`
and `outstandingTokenObligations` now use investor supply. `redeem` reverts
`IssuerAllocationCannotRedeem()` for flagged holders in all three modes. `DeployLocal` flags the
company vesting wallet before minting. `RevenueDistributor.circulatingSupply()` renamed to
`yieldEligibleSupply()` with a deprecated alias. Also fixed `transferRestriction` reporting
`EnforcedPause` for a redemption burn, which contradicted the pause escape hatch in `_update`.
Tests 75 -> 97 (`test/unit/IssuerAllocation.t.sol`, 22 cases). Coverage up on both recorded
baselines (AssetToken 95.65 -> 96.24% lines; overall 80.91 -> 81.65%). Verified end to end on a
fresh Anvil: `deployments/31337.json` is byte-identical (addresses are deterministic), and after a
10,000 mUSD purchase `investorSupply` = 10,000e18 against `totalSupply` = 30,000e18,
`minimumRequiredReserve` = 2,000e6 (was 6,000e6), `reserveRatioBps` = 22,000.
Interface changes: `CONTRACTS_TO_FRONTEND.md` two rows dated 2026-08-27 (D-024 reads + the
`transferRestriction` burn fix); `CONTRACTS_TO_BACKEND.md` two rows dated 2026-08-27 (D-024 event
and derived-view rule + the `yieldEligibleSupply` rename).
Needs: **decision.** D-024 and D-025 conflict — the `issuerAllocation` flag is per address, so a
vesting sale moves tokens into `investorSupply` and *lowers* backing per token, breaking the
"backing is non-decreasing while Active" assumption the D-025 floor ratchet is built on. Three
options and a recommendation are in `docs/DECISIONS.md` open item 0. Task 7 (floor level-up) is
blocked on this; tasks 2-6 are not, so I can continue with the reserve schedule meanwhile.
Note for other stacks: `forge fmt --check` was already failing on `main` before this change (two
ternary wraps in `RevenueDistributor`); since I touched that file I ran `forge fmt` on it, so the
repo is now clean. `backend/` work was in the tree while I ran — I did not touch it.

## 2026-08-30 — contracts — D-031: the issuer receives no token allocation
Branch: main   Commit: (uncommitted working tree)
What: owner decision — SOLAR01 is a revenue-participation note, so the issuer holds no tokens and is
paid in cash (65% settlement proceeds, operator revenue share, residual reserve at close).
`DeployLocal` no longer deploys or funds a `CompanyVestingWallet` and no longer mints at deploy.
Supply at deploy is now 0; 100,000 authorized = 80,000 offering inventory + 20,000 unminted headroom.
`PrimaryOffering` is the only holder of `ISSUANCE_CONTROLLER_ROLE` for the life of the asset — the
deployer's temporary self-grant is gone. D-024's `issuerAllocation` / `investorSupply` machinery is
retained as a guard and stays tested, but nothing sets the flag, so `investorSupply == totalSupply`.
Verified on a fresh Anvil: `totalSupply` 0, `issuerAllocationSupply` 0, offering inventory 80,000e18,
offering has mint role, deployer does not. 97 tests green, `forge fmt --check` clean.
Interface changes: `CONTRACTS_TO_FRONTEND.md` row 2026-08-30 (**frontend copy must change** — the
"20,000 company vesting / 20% company vesting" figures on the asset page, issuer workspace,
action deck and `lib/data.ts` are now wrong); `CONTRACTS_TO_BACKEND.md` row 2026-08-30
(`companyVesting` key removed from `deployments/<chainId>.json`; it is already optional in
`backend/src/config.ts` so nothing breaks, but drop it from `.env.example` when convenient).
Docs: D-031 added; D-005 superseded; D-008 amended; open decision 0 (D-024 vs D-025) resolved —
task 7 is unblocked.
Needs: nothing blocking. One open sub-question in D-031: whether to delete
`src/vesting/CompanyVestingWallet.sol` outright — it is now unused by the demo but still referenced
by a yield-exclusion test. Left in place pending owner confirmation.

## 2026-08-30 — contracts — Branch note (deferred, owner decision)
Branch: backend/foundation   Commit: 2f17372
What: the D-024/D-031 contracts commit was made while this shared working tree was checked out on
`backend/foundation`, so it sits on top of the backend milestone rather than on `main`. The same
commit is also reachable from `contracts/d024-d031`. Owner decided (2026-08-30) to defer the
cleanup — hackathon scope. To fix later: rebase `contracts/d024-d031` onto `main` in its own
worktree, then reset `backend/foundation` to 12ec65d at a point when the backend session is idle.
`CLAUDE.md` is intentionally uncommitted; it holds concurrent backend edits.
Needs: nothing. Recorded so it is not discovered as a surprise at merge time.

## 2026-08-30 — contracts — D-023 reserve schedule and shortfall enforcement (task 2)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `AssetVault` gains a `ReserveSchedule` (`startBacking`, `targetBacking`, `startTime`,
`maturity`, `graceSeconds`), `targetBackingAt`/`targetBackingNow`, `currentBacking`,
`isBehindSchedule`, `shortfallStartedAt`, `isInEnforcedShortfall`, permissionless `syncShortfall`,
and issuer `depositReserve(amount, periodId)`. `withdrawIssuerProceeds` reverts
`ReserveShortfallActive()` past the grace window. `DeployLocal` sets the demo schedule
(0.30 -> 1.00 over three years, 30-day grace).

Design note worth reading: **shortfall start is derived, not observed.** The target curve is
monotonically increasing, so the crossing time is recovered by inverting the line from the current
backing. Enforcement therefore needs no prior `syncShortfall` call — an issuer cannot let a dormant
asset drift behind and then claim a fresh grace window by being first to touch it. `syncShortfall`
exists only to publish events for indexers/UI; the stored `shortfallSince` is never read by the
gate. Verified on Anvil: two years after deploy with zero syncs, `shortfallSince` is 0 while
`shortfallStartedAt` is the true crossing (469.3 days in, matching the closed form to 3 d.p.) and
`withdrawIssuerProceeds` reverts `0xffe4402c`.

Redemption is deliberately not gated by a shortfall — only issuer capital freezes; investors keep
their exit. New invariant: backing never falls through a redemption (mutation-tested: inverting the
comparison makes it fail, so it is not vacuous).

Tests 97 -> 122 (`test/unit/ReserveSchedule.t.sol`, 24 cases; invariants 5 -> 6). `forge fmt --check`
clean. Coverage: `AssetVault` 72.81 -> 83.15% lines and 7.14 -> 50.00% branches; overall
81.65 -> 83.25% lines.
Interface changes: `CONTRACTS_TO_BACKEND.md` and `CONTRACTS_TO_FRONTEND.md`, rows dated 2026-08-30.
Needs: nothing blocking. Next is task 3 (dynamic revenue split + period tagging), which layers the
40/45/10/5 behind-schedule variant on top of `isBehindSchedule()`.

## 2026-08-30 — contracts — D-022/D-023 dynamic revenue split and period tagging (task 3)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `RevenueDistributor` now stores two split variants and chooses per deposit by reading
`vault.isBehindSchedule()` live — 60/25/10/5 on schedule, 40/45/10/5 behind, so holders take less
while the sinking fund catches up. Both are admin-settable via `setRevenueSplits` within bounds
(holders >= 30%, operator <= 15%, protocol <= 10%, each totalling 100%), and the behind-schedule
variant may never route less to the reserve or more to holders than the on-schedule one — the
mechanism cannot be inverted into a way to pay insiders more during distress.
`depositRevenue` now takes `(amount, periodId, reportHash)`; `revenueByPeriod` accumulates and the
event carries the period, the report hash and which split ran. `setReportingPolicy` +
`isReportingOverdue()` expose the D-022 cadence; the flag is deliberately **non-gating** — a missing
report is an offchain covenant breach for the verifier, not a reason to freeze a live market. The
reserve shortfall is what actually freezes issuer capital.
`DeployLocal` sets a 30-day cadence with a 30-day grace.

Verified on Anvil: on schedule `activeSplit` is (6000,2500,1000,500); two years on it flips to
(4000,4500,1000,500) with `isReportingOverdue` true, and a live 1,000 mUSD deposit moved
450 to the reserve, 400 to holders, 100 operator, 50 protocol, recording period 202608.

Tests 122 -> 144 (`test/unit/RevenueSplits.t.sol`, 22 cases). `forge fmt --check` clean.
Coverage: `RevenueDistributor` 85.11 -> 90.37% lines and 68.42 -> 81.48% branches; overall
83.25 -> 84.16% lines.

**Interface changes — read before your next build.** Both boundary docs have rows dated 2026-08-30
marked BREAKING:
- `depositRevenue(uint256)` -> `depositRevenue(uint256, uint256, bytes32)`. The frontend's issuer
  revenue-deposit write **will revert until updated**.
- `RevenueDeposited` gained `periodId` (indexed), `reportHash` and `behindSchedule` before the
  existing amount fields — regenerate the ABI rather than hand-patching decoders.
- The `HOLDER_BPS` / `RESERVE_BPS` / `OPERATOR_BPS` / `PROTOCOL_BPS` constants are removed. Read
  `activeSplit()` instead; the applied split now varies per deposit.
Needs: nothing blocking. Next is task 4 (reserve yield hook), which credits yield to the reserve
while behind schedule and to issuer proceeds once on or ahead of it.

## 2026-08-30 — contracts — D-023 reserve yield hook (task 4)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `AssetVault.accrueReserveYield(amount)` under a new `YIELD_SOURCE_ROLE` routes yield earned on
the protected reserve by schedule state — reserve while behind, `issuerProceeds` once on or ahead.
**Conservative default: with no schedule configured the yield also stays with the reserve**, so a
forgotten schedule cannot silently route investor yield to the issuer. Funds are pulled from the
caller, making classification atomic and ensuring a stray transfer into the vault can never be swept
up as yield; a rebasing-stable integration would instead classify unaccounted surplus, noted in the
NatSpec. New event `ReserveYieldAccrued` carries which bucket grew.
`src/mocks/MockYieldSource.sol` is the demo stand-in; `DeployLocal` deploys it, grants the role and
seeds it with 5,000 mUSD. New `deployments/<chainId>.json` key `mockYieldSource` — added, nothing
renamed, every other address unchanged.

Verified on a fresh Anvil: on schedule a 1,000 mUSD accrual moved 1,000 to `issuerProceeds` and 0 to
the reserve; two years later, behind schedule, the same call moved 1,000 to the reserve and 0 to the
issuer.

Tests 144 -> 157 (`test/unit/ReserveYield.t.sol`, 13 cases). `forge fmt --check` clean. Coverage:
`AssetVault` 85.96 -> 86.77% lines, `MockYieldSource` 100%.
Interface changes: `CONTRACTS_TO_BACKEND.md` and `CONTRACTS_TO_FRONTEND.md`, rows dated 2026-08-30.
Needs: nothing blocking. Next is task 5 (residual return at `Closed` after the maturity window).

## 2026-08-30 — contracts — D-023 residual return and maturity window (task 5)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: maturity redemption is now capped at **par** (`vault.maturityParValue()`, the schedule's end
target) and closes at `assetMaturity + maturityWindowSeconds`, reverting `MaturityWindowClosed()`.
After the window, at `Closed`, the issuer calls `releaseResidualReserve()` and receives
`reserve - investorSupply * min(NAV, par)`. New vault views `maturityParValue`,
`maturityWindowEndsAt`, `outstandingObligationsAtPar`, `residualReserve`; admin
`setMaturityWindow(uint64)`; events `MaturityWindowSet`, `ResidualReserveReleased`.
`DeployLocal` sets a 90-day window.

Two design points worth knowing. First, the par cap is what makes residual return meaningful — with
maturity redemption paying full backing the residual would always be zero, and a note holder is not
entitled to upside above par anyway. Normal and emergency modes are deliberately left uncapped.
Second, only the **excess** is released: `outstandingObligationsAtPar` is retained, so a holder who
never redeemed keeps full par cover and an underfunded asset has no residual at all. A zero window
disables both the deadline and the release, which is the safe default for an unconfigured asset.

Verified on a fresh Anvil across the whole lifecycle: reserve overfunded to 60,000 against 50,000
tokens (backing 1.20); at maturity `redemptionPrice(Maturity)` returned 1.000000 not 1.200000; past
the 90-day window a holder redeem reverted `0x4ddea01e` (= `MaturityWindowClosed()`); at `Closed` the
issuer received exactly 10,000 mUSD and the reserve settled at 50,000 = obligations.

Tests 157 -> 176 (`test/unit/ResidualReserve.t.sol`, 19 cases). `forge fmt --check` clean. Coverage:
`AssetVault` 86.77 -> 88.64% lines, `RedemptionController` 88.06 -> 90.28%; overall 84.03 -> 84.75%.
`deployments/31337.json`: only `mockYieldSource` moved (the new `setMaturityWindow` call shifted the
deployer nonce); every other address is unchanged.
Interface changes: `CONTRACTS_TO_BACKEND.md` and `CONTRACTS_TO_FRONTEND.md`, rows dated 2026-08-30.
Note for backend: `ResidualReserveReleased` debits the reserve **without** a redemption, so a
projection driven only by redemption events will drift.
Needs: nothing blocking. Next is task 6 (settlement split 65/30/5), which is the last D-023 item.

## 2026-08-30 — backend — Milestone B complete: event ingestion, projections, reorg recovery
Branch: backend/foundation   Commit: (this commit)
What: the indexer runs. Address discovery from `AssetSystemDeployed` / `IdentityRegistryAdded` /
`ComplianceAdded` / `ModuleAdded` (only registry, factory and mUSD are configured); kind-keyed
decoding so the shared `Transfer` selector cannot confuse 18-decimal asset movements with 6-decimal
mUSD; 23 projection tables covering identity, lifecycle, NAV, the three supply denominators,
holders, the five vault categories, the D-023 reserve schedule, purchases, revenue, redemptions,
positions, rebalances and ERC-3643 state; one database transaction per block; reorg recovery by
rollback + rebuild. 105 tests green, `typecheck` / `lint` / `build` clean. Verified end to end
against a live Anvil: full replay, restart, and a real `evm_revert` reorg.
Three defects the acceptance tests caught, all fixed:
1. Current-state aggregates (`token_supply`, `vault_balances`, `token_balances`, `position_configs`,
   `identities`) have no block key, so a rollback deleted the history and left the balances carrying
   the orphaned effects. Fixed by re-deriving the read model from the surviving logs
   (`src/indexer/rebuild.ts`, `BACKEND_INDEXER.md` §8.4) rather than writing an inverse per projector.
2. `viem` caches `getBlockNumber` for ~4s by default, so the indexer read a stale head and skipped
   blocks that already existed. Chain client now sets `cacheTime: 0` (§8.5).
3. `/v1/health` reported `degraded` on an idle Anvil because the newest block was older than
   `STALE_AFTER_SECONDS`. A quiet chain is not a sick service; degraded now means the indexer is
   *behind and not catching up*. Data age stays where it belongs, in `meta.stale` per response.
Interface changes: none to `BACKEND_TO_FRONTEND.md` — no new routes yet. `BACKEND_INDEXER.md`
§6.2, §8.4, §8.5 and §17 updated (schema and reorg design are mine to own).
Needs — two for the contracts agent, neither blocking:
1. **`CONTRACTS_TO_BACKEND.md` §1 and §7 are stale after D-031.** §7 still says the seed mints
   20,000 SOLAR01 to vesting and asserts `totalSupply = 20_000e18` / `excludedSupply = 20_000e18`;
   the chain now deploys with total supply 0 and no `CompanyVestingWallet`. §1 still tells the
   backend to read `deployments.json → companyVesting`, a key that no longer exists. My acceptance
   test compares against the contracts' own views instead of those constants, so nothing is blocked
   — but the next reader of that document will be misled.
2. **`AssetVault.MaturityWindowSet(uint64)` is emitted but not in the event catalog.** Found because
   my indexer archived it undecoded and the test that asserts every watched log decodes went red.
   That is the mechanism working, but §2 should list it (and any other event from tasks 4–6) with a
   `CHANGED` row so the catalog stays the contract.
Still open from Milestone A, needed before C: the config-snapshot reader (no event carries the
offering config, `supply.maximum`, `minimumReserveRatioBps`, `tickSpacing` or `assetIsToken0`), and
who owns synthetic OHLC.

## 2026-08-30 — contracts — D-023 settlement split 65/30/5 (task 6); D-023 complete
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `PrimaryOffering` splits 65% issuer / 30% reserve / 5% market (was 70/20/10). Constants only —
no signature or event change. The 30% holdback is now exactly the schedule's 0.30 start point, so a
raise with no seed capital lands on schedule at day zero.

Knock-on: every backing figure in the demo moves. A 50,000 mUSD raise now leaves 35,000 reserve
against 50,000 tokens (backing 0.70, was 0.60), and 12 tests asserting the old arithmetic were
updated to the new expected values rather than loosened. Demo market depth halves (10% -> 5%).

**D-023 is now fully implemented** across tasks 2-6: schedule, shortfall enforcement, dynamic split,
reserve yield, par-capped maturity, residual return, settlement split.

Verified on a fresh Anvil: a 50,000 mUSD purchase produced issuerProceeds 32,500, reserve 35,000
(20,000 seed + 15,000), marketAlloc 2,500, backing 0.700000, on schedule.

Tests 176 passed / 0 failed. `forge fmt --check` clean.

**Boundary-doc corrections (thanks to the backend agent's report).** Auditing `CONTRACTS_TO_BACKEND.md`
against the source found the problem was wider than the one event reported: §2's catalog was missing
**all ten** events added by tasks 1-6, and still carried the pre-D-022 `RevenueDeposited` signature.
§1 pointed at the `companyVesting` key removed by D-031, and §7's replay fixture still described the
vesting mint. All fixed, plus notes that (a) `ReserveYieldAccrued` and `ResidualReserveReleased` move
the reserve without a redemption, and (b) shortfall events are published, not authoritative — a
shortfall can begin with no transaction, and enforcement reads the derived `shortfallStartedAt()`.
Keep the undecoded-log assertion; a missing catalog entry is a contracts-side bug.
Needs: nothing blocking. Task 10 OHLC ownership answered separately — mock pool emits a canonical
`Swap`; I own it.

## 2026-08-30 — backend — Milestone C complete: the /v1 read API
Branch: backend/foundation   Commit: (this commit)
What: every route in `BACKEND_TO_FRONTEND.md` §2 except `/candles` is live — `/v1/assets`,
`/assets/:assetId`, `/metrics`, `/nav-history`, `/positions`, `/activity`, `/revenue`,
`/redemptions`, `/accounts/:address/assets/:assetId`. Each validates its payload against a Zod
schema before sending. 140 tests green; `typecheck` / `lint` / `build` clean; verified against a
live Anvil with the 65/30/5 deployment.
Three things worth knowing:
1. **The config-snapshot reader exists** (`src/chain/snapshot.ts`), resolving the gap flagged in
   Milestone A: the offering price/cap/window/wallet limit, supply cap, reserve ratio policy, tick
   spacing and token ordering are contract *state*, never emitted. It reads them at the **indexed
   block**, not `latest`, so one response never mixes a projection from block N with a view from
   block N+3. No contracts change was needed.
2. **Market price provenance is decided by the pool's bytecode.** `MockUniswapV3Pool` carries
   test-only setters a canonical V3 pool does not, so `spot`/`twap` come back `mock` on Anvil and
   `onchain` only against a real pool. The call is genuine either way; what differs is whether the
   number means anything.
3. **Tick to price is integer math** — a port of Uniswap's `TickMath.getSqrtRatioAtTick`, checked
   against the canonical `MIN_SQRT_RATIO` / `MAX_SQRT_RATIO`. `Math.pow(1.0001, tick)` is a float,
   and a float feeding a chart's band edges is not a number this service publishes.
Interface changes: six `CHANGED` rows in `BACKEND_TO_FRONTEND.md` §6 — routes shipped; `/candles`
absent until D; activity `actor` nullable (three events name no acting party); `metrics.supply`
gains `investor` and `supply.vesting` is always null under D-031; new nullable `reserveSchedule`
block (D-023) whose `targetBackingNow` rises with time and must not be cached past
`staleAfterSeconds`; `spot`/`twap` carry per-field provenance; `?status=` takes the status name.
Also `BACKEND_INDEXER.md` §17 and the header.
Needs: nothing blocking. Frontend can start migrating panels off fixtures — `backend/README.md` has
the route table, and every money field is a decimal string with the raw base units alongside it
wherever the UI might transact.

## 2026-08-30 — contracts — D-025 published protected floor (task 7)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: new `src/market/FloorController.sol`. The protected-floor reference is a pool tick that
ratchets upward one `tickSpacing` per permissionless `levelUp()`, only while
`price(nextTick) <= min(NAV, backing)` and the cooldown has elapsed. `priceAtTick` uses the same
conversion the market manager applies to `slot0`, so the published floor and the market price are
directly comparable 6-decimal values. `AssetMarketManager` gains `rebalanceToFloor(lower, upper)`,
which requires the highest price the range can reach to be at or below the published level -
direction-aware, because with the asset as token1 a higher price is a *lower* tick.

The ceiling is re-derived on every call rather than trusting the stored level, so the ratchet is
correct by construction rather than by assumption.

**One asymmetry, resolved deliberately.** `floorPrice <= backing` holds permanently, because backing
never falls while Active. `floorPrice <= NAV` is only guaranteed at the moment of each level-up: a NAV
markdown can leave a previously valid level above the new NAV. Lowering the floor would defeat the
ratchet, so the level stays and `isFloorCovered()` goes false instead. **This can flip with no event
and no state change** — derive coverage from a live call, not from `FloorLevelUp` history. Publishing
an uncovered floor silently would be exactly the D-010 failure this decision exists to prevent.
There is deliberately no setter for `floorTick`.

Scope call: the optional best-effort `levelUp` attempts from reserve-crediting paths were **not**
implemented. They would couple money-moving vault functions to a non-essential contract, and a
permissionless `levelUp` plus a keeper achieves the same pacing with strictly less risk.

Verified on a fresh Anvil: floor deploys at 0.298335 with `canLevelUp` false (no investors yet);
after a 50,000 raise the ceiling is `min(1.000000, 0.700000)` and it becomes true; one `levelUp` moves
0.298335 -> 0.300130 (exactly one spacing, +0.6%); an immediate second call reverts `0xaa9a98df`
(= `CooldownActive()`); 40 paced steps reach 0.381536, still covered.

Tests 176 -> 200 (`test/unit/FloorController.t.sol`, 23 cases). Invariants 6 -> 7: the published floor
never exceeds backing while investors hold tokens. `forge fmt --check` clean. Coverage:
`FloorController` 96.43% lines, `AssetMarketManager` 98.28%; overall 84.89% lines.
Note: `via_ir` stays **false**. The deploy script hit stack-too-deep and was fixed by extracting a
`_configureFloor` helper, not by enabling the IR pipeline.
Interface changes: `CONTRACTS_TO_BACKEND.md` and `CONTRACTS_TO_FRONTEND.md`, rows dated 2026-08-30.
New `deployments/<chainId>.json` key `floorController` (added, nothing renamed).
Needs: nothing blocking. Next is task 8 (D-026 term-sheet hash binding).

## 2026-08-30 — backend — Milestone D complete: OHLC, both sources
Branch: backend/foundation   Commit: (this commit)
What: `/v1/assets/:assetId/candles` ships, plus the two pipelines behind it. 167 tests green;
`typecheck` / `lint` / `build` clean.
- **Canonical path built before a pool emits it.** `MockUniswapV3Pool` still emits no `Swap`, so
  rather than wait, the path is proven end to end by ingesting a hand-built canonical log: decode →
  price from `sqrtPriceX96` → `pool_swaps` → six interval buckets. When contracts task 10 lands, it
  should light up with no backend change.
- **The pool event ABI is hand-written in `backend/abis/UniswapV3PoolEvents.json`.** This is a real
  gap I hit: `contracts/src/interfaces/IUniswapV3Pool.sol` declares **no events at all**, so nothing
  synced from `contracts/out` can decode a `Swap` and the canonical path would have silently
  produced nothing. The V3 pool is third-party with a published ABI, so it belongs here — and its
  `Swap` topic0 is asserted against the canonical `0xc42079f9…` so a typo cannot pass.
- **Synthetic adapter** for the demo: `ALLOW_MOCK_MARKET_DATA=true` only, always `source: "mock"`,
  deterministic from the pool address and bucket time, and it refuses to overwrite a canonical
  series. With the flag off `/candles` returns `503 MOCK_DISABLED` — never an empty array, which is
  indistinguishable from "never traded" and draws as a flat line at zero.
- **The candle fold is order-independent** (open/close chosen by comparing ordering tuples), so the
  post-reorg rebuild converges. `candles` has no block key, so it joins the rebuild set.
- `change24h` on `/v1/assets` is now real, and still `null` — never `0` — when it cannot be computed.
Verified against token ordering: `assetIsToken0()` on the live manager is **false** for the current
deployment (mUSD `0x5fbd…` sorts below the asset `0xd805…`), and the address-derived ordering the
swap projector uses agrees with it exactly.
Interface changes: five `CHANGED`/`SHIPPED` rows in `BACKEND_TO_FRONTEND.md` §6 — `/candles` live;
`source` never blended and envelope provenance matches; `503 MOCK_DISABLED` by default; `change24h`
computed. `BACKEND_INDEXER.md` header and §17.
Needs — one, for contracts, not blocking:
**`FloorController` (task 7) is invisible to the indexer.** It is not in `AssetSystemDeployed`, so
it is never a watched address and `FloorLevelUp` will never be seen. `AssetMarketManager` now emits
`FloorControllerSet(address indexed controller)`, which is exactly the discovery hook I already use
for the identity registry and compliance — so all I need is the `CHANGED` row with the
`FloorController` event signatures, and confirmation of whether `DeployLocal` deploys one. I have
deliberately *not* wired discovery yet: watching an address whose ABI I cannot decode would turn my
"every watched log decodes" assertion red on purpose.
Also FYI: `forge build` is currently red on the contracts working tree (`AssetFactory.sol`,
`AssetRegistry.sol` mid-edit), so I synced ABIs from the last good artifacts.

## 2026-08-30 — contracts — D-026 term-sheet hash binding (task 8)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `AssetRegistry.approveAsset(assetId, initialNAV, termsHash)` records the hash of the exact
`AssetFactory.DeploymentParams` the verifier reviewed, and `deployAssetSystem` reverts
`TermsMismatch()` unless `keccak256(abi.encode(params))` matches. The struct *is* the canonical term
sheet. New `reapproveTerms`, view `termsHashOf`, event `TermsApproved`, errors `InvalidTermsHash` /
`TermsMismatch`.

Two choices worth knowing. A zero `termsHash` is **rejected**, not treated as unbound — an unbound
approval would let any parameters through, which is the hole this closes. And `reapproveTerms` is
restricted to `Approved`: once deployed, the stored hash describes what actually exists, so letting it
drift would make `termsHashOf` unreliable. A post-deployment amendment is an offchain legal event.
The gate runs before structural parameter validation, so nothing unapproved reaches the rest of the
factory — `ComplianceGate.testFactoryRejectsMissingIdentityRegistry` now approves the hash of its own
deliberately-broken params to prove structural validation is still a real second line of defence.

Verified on a fresh Anvil: the seeded asset deploys with
`termsHashOf = 0xa9be7bb3…d188`, status Active, and `reapproveTerms` on the live asset reverts
`0xf525e320` (= `InvalidStatus()`).

Tests 200 -> 214 (`test/unit/TermSheetBinding.t.sol`, 14 cases). `forge fmt --check` clean.
`AssetFactory` coverage 96.23% lines.
Interface changes: both boundary docs, rows dated 2026-08-30, marked **BREAKING** —
`approveAsset` gained a third parameter (the frontend verifier approve button will revert until
updated) and the `Asset` struct gained `termsHash` **before** `status`, so `getAsset` tuple decoding
shifts. Regenerate ABIs.

Answers to the backend session's questions, recorded here so they do not live only in chat:
- `FloorController` event signatures are in the `CONTRACTS_TO_BACKEND.md` row dated 2026-08-30
  (`FloorLevelUp`, `FloorLevelCooldownSet`), and its views are now pinned in §9.
- Yes, `DeployLocal` deploys one and writes the `floorController` key; discovery via
  `AssetMarketManager.FloorControllerSet(address indexed)` is the intended hook.
- `floorTick` / `floorPrice()` are live reads for `/metrics`. `isFloorCovered()` especially: it can
  flip with no event.
- `IUniswapV3Pool` is a functions-only stub and declares no events, so nothing synced from
  `contracts/out` can decode a canonical `Swap` today. Task 10 adds `Swap` and `Initialize` to the
  interface when `MockUniswapV3Pool` starts emitting them; until then a hand-written pool-events ABI
  on the backend side is the right call.
- `assetIsToken0() == false` on the current deployment, confirmed live. mUSD sorts below the asset.
Needs: nothing blocking. Next is task 9 (D-028 class-based purchase caps), then task 10.

## 2026-08-30 — backend — D-025 floor and D-026 terms surfaced in the API
Branch: backend/foundation   Commit: (this commit)
What: picked up contracts tasks 7 and 8. `FloorController` is now discovered through
`AssetMarketManager.FloorControllerSet` — it is not in `AssetSystemDeployed`, so without following
that announcement its events would never have been seen. `FloorLevelUp` history is projected;
`TermsApproved` fills `assets.terms_hash`. 173 tests green.
The one design point worth stating: **the floor's current level is a live read, never a projection,
and `covered` lives inside the `floor` object rather than beside it.** `isFloorCovered()` can go
false with no event and no state change — a NAV markdown can leave a valid level above the new NAV,
and D-025 pauses the ratchet rather than lowering the floor. A projected coverage flag would be
correct only until the next markdown, and a floor rendered without the flag asserts something the
contract does not. There is a test asserting the flag cannot be separated from the level.
Task 8 was breaking on paper but not in practice here: I read `statusOf` / `navOf` / `maturityOf` /
`issuerOf` individually rather than decoding the `getAsset` tuple, so the new `termsHash` field
shifting the struct did not affect me. `TermsApproved` and `termsHashOf` are now both consumed.
Interface changes: two `CHANGED` rows in `BACKEND_TO_FRONTEND.md` §6 — the nullable `floor` block
on `/metrics` with coverage attached, and `termsHash` + `contracts.floorController` on the asset
detail route.
Needs: nothing.

## 2026-08-30 — contracts — D-028 class-based subscription caps (task 9)
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
What: `PrimaryOffering` gains per-investor-class caps driven by `IdentityRegistry.investorClass`.
`setClassLimit(class, walletLimit, aggregateCap)` (admin); an unconfigured class falls back to the
global `walletPurchaseLimit`, so nothing changes until a class is deliberately configured. Optional
per-class aggregate cap tracked in `raisedByClass`. New views `investorClassOf`,
`effectiveWalletLimit`, `remainingAllowance`; event `ClassLimitSet`; errors
`ClassWalletLimitExceeded` / `ClassAggregateCapExceeded`.

Design point: a configured class limit **replaces** the global `walletPurchaseLimit` rather than
stacking with it. D-028 says "falling back to `walletPurchaseLimit`", and stacking would have capped
an institution at the retail-era global figure — the opposite of the intent. `type(uint256).max`
expresses "uncapped within the fundraising cap", which still bounds everyone. My first cut stacked
them and the institutional test caught it.

`remainingAllowance(buyer)` is the number a UI should display: min(effective wallet cap, class
aggregate remaining, raise remaining). `walletPurchaseLimit` alone is wrong once any class is set.

**Demo identities changed — this affects fixtures.** So both ends of the range are demonstrable:
the deployer is now institutional (3), Anvil #1 (the main demo investor) is **accredited** (2) rather
than retail so its 50,000 headroom is unchanged, and **Anvil #2 is a newly registered retail wallet**
(1) that exists purely to show the 5,000 cap bite. Demo limits: retail 5,000 / accredited 50,000 /
institutional uncapped.

Verified on a fresh Anvil: classes resolve 2 and 1; allowances read 50,000 and 5,000; the retail
wallet buys exactly 5,000, its allowance drops to 0, and one more mUSD reverts `0x06e6436e`
(= `ClassWalletLimitExceeded()`); the accredited wallet still takes 50,000; `raisedByClass` reads
5,000 retail / 50,000 accredited.

Tests 214 -> 232 (`test/unit/ClassPurchaseCaps.t.sol`, 18 cases). `forge fmt --check` clean.
Interface changes: both boundary docs, rows dated 2026-08-30. `PrimaryOffering`'s new views are added
to the §9 pinned surface.
Needs: nothing blocking. Task 10 is the last one — mock pool emits canonical `Swap` + `Initialize`,
`DEMO_SEED_LIQUIDITY`, factory role-renounce decision.

## 2026-08-30 — contracts — Task 10: canonical pool events, demo seeding, factory role hygiene
Branch: backend/foundation (see branch note above)   Commit: (uncommitted)
**The contracts task list is complete (1–10 plus D-031).**

Three parts.

**Canonical pool events.** `IUniswapV3Pool` now declares `Initialize` and `Swap` with v3-core's exact
argument order, so they appear in the synced `MockUniswapV3Pool` artifact and the backend can drop
its hand-written pool-events ABI. `Swap` topic0 verified as
`0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`, asserted in the test rather
than trusted. The mock now moves `sqrtPriceX96`/`spotTick` on every swap and emits both events.
Direction is canonical (selling token0 lowers the tick); magnitude is a labelled linear stand-in —
`swapImpactUnit` of input moves one `tickSpacing`, capped by `maxTickMovePerSwap`, and setting the
unit to zero pins the price for deterministic tests. It still models no impact curve, no tick
crossing, no fee growth and no liquidity exhaustion, so candles from it are a **labelled demo feed,
never price discovery**.

**`DEMO_SEED_LIQUIDITY`.** Off by default. Seeding needs both supply and market allocation, and both
are zero at deploy (D-031 mints nothing; market allocation only arrives with a purchase), so the flag
makes a real 10,000 mUSD purchase as the deployer — a verified institutional wallet — then funds the
engine and adds an anchor position. It is off by default precisely because it changes the seeded
chain from "nothing has happened yet" into "one purchase has happened", which is a different fixture
for the other stacks. Verified both ways: default gives totalSupply 0 / pool liquidity 0; seeded
gives totalSupply 10,000e18 / pool liquidity 1,000 / reserve 23,000e6.

**Factory role hygiene — a real finding, now D-032.** The factory is passed as `admin` to every
component constructor, and those constructors grant the admin more than `DEFAULT_ADMIN_ROLE`: also
`PAUSER_ROLE` on all six, `KEEPER_ROLE` on the redemption controller and market manager, and
`REVENUE_DEPOSITOR_ROLE` on the distributor. The handoff renounced only the admin role, so the
factory permanently held **pauser on every component of every series it had ever deployed**, plus
keeper on two. Not exploitable today — the factory has no function that calls into them — but a
standing privilege with no purpose and a large blast radius, and the first thing a reviewer scanning
role holders would flag. Now renounced in full, admin last. `FactoryRoleHygiene.t.sol` asserts both
directions: the factory ends up holding nothing, and nothing it gave up lost its holder. If you track
role holders, the factory disappears from all six components.

Tests 232 -> 247 (`FactoryRoleHygiene.t.sol` 7 cases, `MockPoolSwapEvents.t.sol` 8 cases).
`forge fmt --check` clean. `via_ir` still false.
Interface changes: `CONTRACTS_TO_BACKEND.md` row dated 2026-08-30.
Note: `contracts/deployments/31337.json` is deliberately **not** in this change. Both the committed
snapshot and my verification runs came from Anvil instances with residual state, so neither holds
canonical fresh-chain addresses. It is documented as a snapshot to regenerate, not a registry —
regenerate it from a genuinely fresh chain before the demo.
Needs: nothing. The contracts track is done; remaining work is whatever the owner prioritises next.
