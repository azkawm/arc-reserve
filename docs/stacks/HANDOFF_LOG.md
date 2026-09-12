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

## 2026-08-30 — backend (acting on frontend) — Milestone E: the fixture → API migration
Branch: backend/foundation   Commit: (this commit)
**Note for whoever resumes the frontend stack: the frontend migration now lives on
`backend/foundation`, not on `frontend/kyc-and-correctness`.** That branch is clean and ~13 behind
with docs-only commits and no `frontend/` diff, so resuming there would rebuild against the
pre-migration tree. Fast-forward it or work from this line.
What: the owner asked this session to do the migration directly. Built the provenance layer and
moved the marketplace and asset page off fixtures. `typecheck`, `lint`, `build` all green.
- `src/lib/api.ts` — typed client, the §1 envelope, the full §3 response types.
- `src/lib/queries.ts` — React Query hooks, keys namespaced `["api", route, …]`, `staleTime` held
  below the backend's own staleness window so the UI never asserts freshness the API disclaimed.
- `src/lib/fixtures.ts` — adapts `data.ts` into the API shapes, so components read one type and
  decide from `meta.provenance` rather than from scattered "demo mode" branches.
- `src/components/data-source.tsx` — `DataSourceBadge`, `PanelLoading`, `PanelError`, and a
  `DataPanel` that takes the query result directly so "I forgot the error case" is unreachable.
- Migrated: marketplace hero/stats/list, asset header, chart panel, supply structure, floor card,
  positions, holdings. Every hardcoded literal is gone from those panels — verified by grep.
The distinction the whole thing rests on: **no API URL ⇒ fixture mode with Mock badges; API URL
present but failing ⇒ error state, never a fixture.** Those look the same in a screenshot and are
completely different claims.
Also fixed in the backend, prompted by task 9: `/accounts` `remainingWalletLimit` now reads
`remainingAllowance(buyer)` instead of subtracting purchases from the flat `walletPurchaseLimit`.
The old number was wrong the moment any class was configured, and the demo now configures three.
Verified live: accredited Anvil #1 shows 50,000, retail Anvil #2 shows 5,000.
Interface changes: none to `BACKEND_TO_FRONTEND.md`. `docs/FRONTEND.md` §3 now carries the
real-versus-mock table.
Not migrated (still fixtures, still badged): issuer profile and asset story copy, keeper history,
engine controls, `/issuer` and `/verifier` panels, lock-and-earn preview.
Needs: nothing. The chart stays `Mock` until contracts task 10 makes the pool emit canonical swaps.

## 2026-09-05 — architect — Handover prepared
Branch: main   Commit: (this commit)
What: `HANDOVER.md` written at the repo root (state, remaining work, onboarding gate, working
agreements, environment quirks, known stale spots); `docs/TESTING.md` baseline refreshed to 247;
pending CLAUDE.md/deployment refresh committed; merged `contracts/d024-d031` branch pruned; main
fast-forwarded. Incoming maintainer: start at `HANDOVER.md`, announce yourself here per §5.6.
Interface changes: none
Needs: nothing

## 2026-09-11 — contracts — Correction: "track done" meant tasks 1–10; D-027 testnet scope is open
Branch: main   Commit: (uncommitted)
What: my 2026-08-30 task 10 entry said "The contracts track is done". That was accurate only for the
ten numbered tasks in `AGENT_CONTRACTS.md`. The D-027 scope deliverables in the same brief have not
been started:
- no chain-aware deploy script keyed on `block.chainid` — only `script/DeployLocal.s.sol` exists;
- no `deployments/84532.json` (Base Sepolia) or `deployments/296.json` (Hedera testnet);
- the Base Sepolia Uniswap V3 factory address has not been verified from Uniswap's official list;
- the Hedera path (mock pool unless a V3-compatible factory is verified) is not built;
- `evm_version` is not pinned in `foundry.toml` (Hedera's supported EVM version must be checked first).
Without these the demo cannot run on either target chain.

Verified 2026-09-11 on `main`: 247 tests / 0 failed / 7 invariants, `forge fmt --check` clean; all
ten contracts commits (`2f17372`..`1d13218`) are on `main` and `main == origin/main`;
`deployments/31337.json` holds fresh-chain addresses (`mockUSD` = `0x5FbDB2…0aa3`, the first CREATE
on a fresh Anvil), regenerated in `a043f0d`.

Also stale and flagged, not fixed here: the `CLAUDE.md` contract-model prose still says the offering
splits 70/20/10 (now 65/30/5), describes the removed D-031 vesting mint, gives
`minimumRequiredReserve` and redemption backing over total supply (investor supply since D-024) with
no maturity par cap, quotes a 74-test / 5-invariant baseline (247 / 7), says the mock pool emits no
canonical `Swap` (it has since task 10), and keeps the pitfall that the local script wires vesting.
Interface changes: none.
Needs: owner — (1) sequencing: testnet prep vs D-007 escrow; the architect recommends testnet first
(HANDOVER §4); (2) funded deployer keys for 84532 and 296 in an untracked `.env`; (3) approval for the
`CLAUDE.md` fix. Queued after testnet prep: branch coverage in money paths (RedemptionController ~41%,
AssetRegistry ~20%, AssetVault ~58% branches).

## 2026-09-11 — architect — Answer key and CLAUDE.md refreshed; frontend regression logged
Branch: main   Commit: (this commit)
What: AI_COMPREHENSION_CHECK Part B refreshed against main (answers 5, 9, 11, 14, 18, 27-30, 37,
scenarios 2/3 — grade only against the 2026-09-11 version); CLAUDE.md stale contract-model prose
fixed per Contract Arch's list (65/30/5, D-031 no issuer allocation, investor-supply denominators,
247 tests / 7 invariants, canonical Swap events since task 10). Also committing Contract Arch's
2026-09-11 correction entry that was pending in the tree.
Known regression (found by arcreserve-19, fix assigned to frontend task 1): the issuer revenue form
still calls the removed `depositRevenue(uint256)` selector — every UI revenue deposit reverts on
main; `depositReserve` (D-023) and `approveAsset(...,termsHash)` (D-026) have no frontend wiring.
Interface changes: none
Needs: owner — grade the frontend agent's comprehension answers; confirm testnet-first sequencing;
provide funded Base Sepolia / Hedera testnet deployer keys when the deploy script lands.

## 2026-09-11 — backend — Architect's assignments: demo chart path, re-verification, open findings
Branch: main   Commit: (this commit)
What:
- **Re-verified the backend suite on `main`: 175/175 green.** Fixed the stale "140 tests" in
  `backend/README.md`. The 175 in `CLAUDE.md` is still correct, so it didn't need changing.
- **Worked out and verified the chart path on a fresh Anvil, then wrote it into `docs/DEMO.md`
  §4.1.** "One keeper swap after deploy" does **not** work on a default deploy, for two reasons:
  - the market maker holds no inventory until the deploy runs with `DEMO_SEED_LIQUIDITY=true`;
  - the seeded pool holds only 1,000 base units of each token and pays each swap's output from that
    balance, so any swap big enough to move the price reverts.

  What does work: a seeded deploy, then `addLiquidity(Anchor, 1e8)`, then three keeper swaps each
  sized below the pool's balance of the token it pays out. With `ALLOW_MOCK_MARKET_DATA=false`,
  `/candles` then returns 200 `canonical_swap`. The 1-minute bar was O 1.000302 / H 1.000502 /
  L 1.000202 / C 1.000502, from 3 trades and 139.7 mUSD of stable volume. Ticks went 276324 →
  276321 → 276322 → 276319, exactly as predicted. `ALLOW_MOCK_MARKET_DATA=true` is documented as
  the fallback.
- `HANDOVER.md` §7 and `DEMO.md` §3 now say Anvil must run in a normal terminal.
- `DEMO.md` §4 no longer lists the vesting steps or the `companyVesting` check, both removed by D-031.
- `DEMO.md` §11 gained recovery rows for an **Unavailable** chart and a reverting swap.

Carried over from my 2026-09-11 status report, as assigned:
- The `?chainId=` query parameter is reserved in Boundary C but not implemented. Held until the
  testnet deployments land; after that it's my next task.
- The testnet indexer settings are unverified: `START_BLOCK` = factory deploy block,
  `CONFIRMATIONS` > 0, and a `MAX_BLOCK_RANGE` the hashio relay actually accepts. I'll measure
  these rather than assume them.
- An optional route showing role-grant activity (a D-032 showcase) is parked behind everything above.
- Checking the frontend renders in a real browser was routed to the frontend agent; the stale
  `frontend/kyc-and-correctness` branch is with the architect.

New finding — needs a decision:
- **Candles from the demo pool are labelled `derived`, not `mock`.** The swaps are real onchain
  events, but the price comes from the stand-in model (a fixed linear impact per unit of input).
  The frontend therefore shows these candles with a **Derived** badge and hides its demo-feed
  disclaimer, which only fires for `source: "mock"`. That contradicts the commitment, made when
  task 10 landed, that the chart stays mock-badged.
  - Proposed fix: the candle route decides provenance with `poolIsCanonical`, the same check
    `spot` and `twap` already use. That needs a Boundary C CHANGED row.
  - The frontend would also key its disclaimer on provenance instead of `source`.
  - I haven't changed anything yet, because it's an interface change. Until it's decided,
    `DEMO.md` §4.1 tells the presenter to say the caveat out loud.

Interface changes: none.
Needs: the architect decides on the demo-pool candle labelling fix above (it touches backend and
frontend).

## 2026-09-11 — backend — Demo-pool candles are labelled `mock`

The architect approved the candle provenance fix proposed in the entry above.
- `/candles` now sets `meta.provenance` to `mock` whenever the pool is not a canonical V3 pool,
  using the same `poolIsCanonical` bytecode check as `spot` and `twap`. `source` stays
  `"canonical_swap"` for real `Swap` events. `source` says where the events came from;
  `provenance` says whether the price is market data (D-019).
- `test/integration/candle-provenance.test.ts` covers both pools: the demo pool gives
  `canonical_swap` + `mock`, a canonical pool gives `canonical_swap` + `derived`.
- `DEMO.md` changes: the §4.1 caveat now describes the fix. The §1, §2 and §6 sections were
  checked against `DeployLocal`: 247 contract tests; Anvil #0/#1/#2 registered as
  institutional/accredited/retail; no vesting beneficiary under D-031.

Interface changes: Boundary C CHANGED row, 2026-09-11 (`/candles` provenance).
Needs: frontend (arcreserve-19) to key the chart badge and demo-feed disclaimer on
`meta.provenance` instead of `source`.

## 2026-09-11 — architect — Demo faucet page added (frontend/public/faucet.html)
Branch: main   Commit: (this commit)
What: owner-requested demo tool. Single static dependency-free HTML at /faucet.html: wallet path
(caller runs faucet(), +100k mUSD, chain-guarded to 31337) and no-wallet path (Anvil #0 unlocked
account calls faucet(recipient, amount) for any address). Shows recipient balance and
IdentityRegistry.isVerified. Verified live: page 200, no-wallet path funded Anvil #2 with 5,000
mUSD, isVerified encoding correct. DEMO.md §6 documents it. Static public asset, no app code
touched — additive to the frontend stack; arcreserve-19 informed.
Interface changes: none
Needs: nothing

## 2026-09-11 — architect — DeployTestnet.s.sol: Base Sepolia ready pending funding
Branch: main   Commit: (this commit)
What: owner asked the architect session directly to create the testnet script while Contract Arch
held for in-window confirmation. `script/DeployTestnet.s.sol`: chains 84532/296 only (31337 keeps
DeployLocal, mainnet refused); PRIVATE_KEY hard-required with the ten Anvil dev keys refused in
broadcast context; Base Sepolia uses the canonical Uniswap V3 factory
0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24 (verified from Uniswap's official deployments page and
onchain: feeAmountTickSpacing(3000)=60; note the same address is V2 Router02 on Base mainnet —
chain-specific, never copy); Hedera keeps the mock factory. Token-ordering is predicted via
vm.computeCreateAddress and asserted post-deploy; the pool initializes at exactly 1.000000 mUSD for
either ordering; canonical path grows observation cardinality (TWAP-gated manager ops stay dormant
until the ring ages — expected) and skips setOracleForTest/seeding. foundry.toml pins
evm_version = "cancun" (Hedera Besu ceiling; bytecode unchanged, 247 tests green).
Verified on an Anvil fork of Base Sepolia (real factory bytecode): full broadcast succeeded, pool
created by the canonical factory, slot0 tick +276324, fee 3000; both key guards fire. Fork
artifacts deleted — deployments/84532.json will only ever come from a real broadcast.
Gas measured on the fork: ~48.6M total → 0.02 Base Sepolia ETH is ample funding.
Owner state: contracts/.env exists with a fresh key; deployer 0xE0Dc359551aDe384cC4c90f89100016898aC1E61
currently holds 0 ETH on Base Sepolia — broadcast waits only on faucet funding.
Interface changes: none (new script only; deployment JSON gains chainId/poolFactory/poolIsCanonical keys).
Needs: owner funds the deployer, then runs the §broadcast command; Contract Arch to review the
script and own the Hedera (296) leg + real-broadcast verification flags (--verify with Basescan).

## 2026-09-11 — contracts — Review of DeployTestnet.s.sol: Hedera blocked by the 15M cap; ranges inverted on Base
Branch: main   Commit: (uncommitted — review only; no source files changed)
What: adversarial review of the architect's `script/DeployTestnet.s.sol` (266f974), plus measurement.

**CRITICAL — Hedera (296) cannot deploy with the current factory.** On a local Anvil with chain id
296 (the mock path Hedera uses), throwaway key, `--slow`: 43 transactions, 45,863,028 gas in total, with
`deployAssetSystem` using **15,294,153** — 294,153 (~2%) over Hedera's hard 15,000,000 per-transaction
cap (docs.hedera.com "Gas and Fees": rejected at precheck with `INDIVIDUAL_TX_GAS_LIMIT_EXCEEDED`).
Forge's default 130% multiplier puts the limit at 22.4M, so it fails precheck regardless. Options:
two-phase factory (recommended; changes AssetFactory's interface), shave ~300k gas (fragile), bypass the
factory on Hedera (breaks the D-026 demonstration), or defer Hedera. Owner decision. Ruled out: Hedera's
24KB creation cap (largest directly deployed contract: MarketDeployer 18,877 B), and child-address
drift (HIP-729, Final v0.40: contract nonces start at 1 and CREATE derives child addresses EVM-style).

**HIGH — position ranges are price-inverted for the token1 ordering**, which is the live branch on Base
Sepolia (pool at +276,324, `assetIsToken0 == false`) and on local Anvil. `_configureMarket` in both
DeployTestnet and DeployLocal (and `ArcReserveTestBase._configurePositions`) place ReserveFloor at
274,800–276,000 (above $1 in asset-price terms) and Discovery at 276,600–278,400 (below $1). Fix: swap
them for token1 — floor (276_600, 278_400), discovery (274_800, 276_000). Found in task 7 and fixed only
in my own test fixture; the scripts were missed.

**MEDIUM**
- A fresh canonical pool reverts `OLD` from `marketPrices()` / `safetyState()` (pinned §9 views) and
  all eight `_enforceSafety` callers for 30 minutes. It self-recovers, but cardinality 60 covers only 60
  pool-touching blocks per 30-minute window — raise it to ~900 on Base or document the bound. Backend and
  frontend should show those reverts as "TWAP warming up".
- `collectFees` doesn't poke (`burn(lower, upper, 0)`) before `collect` on a real pool, so fees are reported
  stale (none lost). `removeLiquidity` is correct.
- `executeSwap` forwards `sqrtPriceLimitX96`; 0 works on the mock and reverts `SPL` on a real pool.
- D-026 binds only `DeploymentParams`. The seed reserve, reserve schedule, class caps, maturity window,
  reporting cadence, compliance modules, ranges, floor, yield grant and splits are all set after deploy
  and remain admin-settable, so task 8's "closes the approved-X, deployed-Y gap" claim holds only for
  factory parameters. Recommend documenting under D-029 now and adding a policy hash plus
  `sealConfiguration()` later.

**LOW**
- The ordering `require` and all simulated addresses are checked only during simulation — add a
  post-broadcast diff of `registry.getAsset(assetId).contracts_` against `deployments/<chainId>.json`.
- Untracked `deployments/84532.json` came from a fork rehearsal with sender `0x293a…a91e`, not the
  owner's deployer, so its addresses won't match the real broadcast: don't commit it. Clear
  `broadcast/DeployTestnet.s.sol/84532/` before the real run.
- That rehearsal's receipt log shows 16 transactions with gas used above their own limit, so its
  per-transaction figures are untrustworthy. Use `--slow` for the real broadcast.

Verified correct: PRIVATE_KEY required and Anvil keys refused under broadcast; the Base factory pin;
`initialSqrtPriceX96` for both orderings; FloorController start tick; `evm_version = "cancun"` (no bytecode
change); component deployers use CREATE.
Funding estimate: Base Sepolia ~0.0003 ETH (48.6M gas × 0.006 gwei); Hedera ~54 HBAR once the cap is solved.
Interface changes: none.
Needs: owner — (1) the Hedera route: two-phase factory vs defer; (2) go-ahead to fix the inverted ranges
in DeployTestnet, DeployLocal and the test base before the real Base broadcast.

## 2026-09-12 — architect — Review findings actioned: range inversion fixed, ring 900, D-026 note
Branch: main   Commit: (this commit)
What: from Contract Arch's DeployTestnet review. (1) HIGH range inversion fixed in all three
places — DeployTestnet, DeployLocal, ArcReserveTestBase else-branches now put the reserve floor at
the high-tick end and discovery at the low-tick end for the stable-first ordering (matching the
FloorController fixture); 247 tests green on the fixed layout, and a fresh fork rehearsal deployed
clean (this run happened to come out asset-as-token0, so both orderings have now been exercised).
(2) MEDIUM TWAP ring: increaseObservationCardinalityNext raised 60 → 900. (3) D-026 scope note
added to DECISIONS (option iii accepted for the demo; sealConfiguration() is the production path).
(4) Fork artifacts (deployments/84532.json, broadcast/DeployTestnet.s.sol) deleted; the real
84532.json only ever comes from the owner's broadcast, run with --slow.
Still open from the review: CRITICAL Hedera 15M cap (owner decision: split factory vs defer —
architect recommends defer, ship Base first); MEDIUM collectFees pre-poke and executeSwap
sqrtPriceLimit bounds (AssetMarketManager changes — contracts backlog); LOW post-broadcast
address re-check; cross-stack "TWAP warming up" rendering for safetyState/marketPrices reverts
(backend + frontend backlog).
Interface changes: none
Needs: owner — Hedera decision (defer recommended); faucet funding for 0xE0Dc…1E61, then broadcast.

## 2026-09-12 — architect — BROADCAST HOLD: EIP-7825 cap on Base Sepolia; ring growth stepped
Branch: main   Commit: (this commit)
What: Contract Arch proved by raw-transaction probe that Base Sepolia enforces EIP-7825's
16,777,216 per-transaction gas-limit cap (checked at precheck, before balance). Two canonical-path
transactions exceed it: deployAssetSystem (~18.4M with the real pool's code deposit) and the
architect's 900-slot ring call (~19.9M). Local Anvil forks do NOT enforce the cap, which is why
both rehearsals passed — a limitation now on record: fork rehearsals validate logic and ordering,
not chain-level tx policy. Fixed here: ring growth stepped 300/600/900 (~6.6M each, idempotent).
NOT fixed here: deployAssetSystem needs the two-phase factory split for BOTH chains (Hedera 15M <
Base 16.78M, so one split sized under 15M serves both). Split design belongs to Contract Arch once
the owner rules; architect guidance: keep the AssetSystemDeployed event emitted once, at
completion, with its current shape, so backend discovery needs no change.
DO NOT BROADCAST until the split lands: a broadcast now would half-deploy (first ~15 txs succeed,
deployAssetSystem fails) and burn nonces, shifting every address on retry.
Interface changes: none yet (the split will carry CHANGED rows).
Needs: owner — confirm the factory split (it is now required for any testnet, not a choice
between chains); ideally confirm directly in Contract Arch's window, since that session takes
build orders only from the owner.

## 2026-09-12 — contracts — Exact canonical-path gas; the factory split is needed for Base too
Branch: main   Commit: (uncommitted — measurement only; no source files changed)
What: measured `DeployTestnet` on a local Base Sepolia fork (pre-Osaka ruleset so every transaction
executes, `--slow`, throwaway key; all 44 receipts consistent), against main including the stepped ring fix.
- `deployAssetSystem`: **18,424,318 gas used** (forge limit 25,448,588). Over Base Sepolia's EIP-7825 cap
  of 16,777,216 by 1,647,102 (~9.8%) even with an exact limit, and over Hedera's 15,000,000 by 3,424,318.
  It is the only transaction over either cap.
- Stepped `increaseObservationCardinalityNext`: 6,678,078 / 6,700,316 / 6,700,316, all under both caps —
  the ring fix is confirmed.
- Canonical path total 67,363,819 gas (≈0.0004 ETH at 0.006 gwei). The mock path (Hedera) measured
  15,294,153 for `deployAssetSystem`.

Consequence: "defer Hedera, ship Base" no longer avoids the factory split; Base needs it too. One
two-phase split sized under 15M serves both chains. Proposed shape, sized from `forge build --sizes`
(the model reproduces both measured totals): phase 1 `beginAssetSystem(params)` — D-026 check,
Token/Vault/Offering/Revenue, store partial deployment + params hash, asset stays Approved, ≈9–10M;
phase 2 `completeAssetSystem(assetId, params)` — re-check the hash, Redemption + pool + MarketManager,
`setAssetContracts`, `activateAsset`, D-032 renounce, `AssetSystemDeployed` emitted once in today's shape,
≈10.5M canonical / ≈7.5M mock. Phase 2 is idempotent on retry, so the assetId is not burned.
`deployAssetSystem` would be retired (CHANGED row); the backend event surface is unchanged.
Interface changes: none yet.
Needs: owner — rule on the two-phase factory split. The Base broadcast stays on hold until it lands.

## 2026-09-12 — contracts — Forensics of the failed Base Sepolia broadcast: nothing completed, orphan inert
Branch: main   Commit: (uncommitted — read-only forensics; no source files changed)
What: the owner broadcast `DeployTestnet` to real Base Sepolia before the factory split landed, and the
EIP-7825 precheck rejection happened as predicted. Chain-derived findings (not artifact-derived):
- Deployer `0xE0Dc…1E61`: nonce **59**, stable across checks (nothing in flight), balance 0.0998 ETH.
- Nonce sweep 0–60 with runtime-size fingerprints: contracts at nonces 0–8 (`MockUSD`, `AssetRegistry`,
  the six ComponentDeployers, `AssetFactory` — exactly `_deployCore` in order) and nonce 11
  (`IdentityRegistry`). Nonces 9,10,12,13,14 are the intervening CALLs.
- **No deployment ever completed.** The only registry (`0x481C18A9…`) logs AssetSubmitted, NAVUpdated,
  TermsApproved and AssetStatusChanged once each and **no AssetContractsSet**; the only factory
  (`0xFEb03CF0…`) logs 2 RoleGranted + 1 PoolFactoryApprovalChanged and **no AssetSystemDeployed**.
  Asset `0x618d32ff…` is Approved with all six `contracts_` zero. A precheck rejection consumes no
  nonce, which matches.
- The orphan is inert: no vault/offering/token/pool exists; `offering.buy` requires `canIssue` → Active,
  and the asset can never reach Active because the only factory able to activate it needs 18.4M gas on a
  chain capped at 16,777,216. MockUSD is a public-faucet token. Sole lingering privilege: the dead
  factory still holds FACTORY_ROLE on the registry.
- **Unexplained:** one failed run needs ~15 nonces but the deployer is at 59, and contracts exist at
  nonces 15–18 (`MockUSD`, `ModularCompliance`, `CountryAllowModule`, `TransferLockModule`) and 39
  (`MockYieldSource`) — all of which a script only reaches after a successful factory call. Something
  other than a plain `DeployTestnet` run was executed against 84532; the owner should say what.
- Caution for anyone reading `contracts/deployments/84532.json`: it is written during *simulation*, so it
  names addresses whose on-chain occupants came from other attempts. It currently labels `0x28f9F554…`
  as `registry` when that address holds a ModularCompliance, and it rewrote itself at 07:02 with no
  nonce consumed. It should be deleted; a successful run regenerates it.

Recovery recommendation: **(a) fresh full redeploy once the split factory exists**, not reuse of the live
registry. A full canonical run is 67.4M gas ≈ 0.0004 ETH against a 0.0998 ETH balance, so cost decides
nothing; reuse would need a bespoke one-off script (skip core, grant FACTORY_ROLE to the new factory,
revoke from the old, `reapproveTerms` because the params hash changes with the new timestamps) run
straight against a public chain, and would leave two TermsApproved events and a second privileged factory
on one registry — the D-032 smell. Optional tidiness with (a): `closeAsset` the orphan and revoke the dead
factory's FACTORY_ROLE.

Also found: `DeployLocal` has **no chain guard**. Against Base Sepolia its mock path (15,294,153 gas) fits
under the cap and would largely succeed, producing a real-looking deployment backed by a mock pool on a
public chain. Adding `require(block.chainid == 31337)` in the split commit.
Interface changes: none.
Needs: owner — (1) confirm the split build (design frozen, architect signed off); (2) explain the extra
runs against 84532 so any contract holding roles is accounted for before redeploying.

## 2026-09-12 — contracts — Forensics addendum: replay confirmed, and a second deployer key
Branch: main   Commit: (uncommitted — read-only)
Testing the architect's replay hypothesis against constructor arguments:
- **Confirmed.** `MockYieldSource` at nonce 39 (`0x238b5704…`) has `stablecoin()` = `0xBdEb4c03…`
  (attempt 1's live MockUSD, nonce 0) and `vault()` = `0x6064c26f…` with **no code — never created**. A
  contract can only be built against a never-existent vault if its payload came from a simulation and was
  sent verbatim afterwards, i.e. a replayed broadcast tail. This also explains the MockUSD→ModularCompliance
  adjacency: nonce 15 is a fresh attempt's first CREATE, nonces 16–18 are attempt 1's `_configureCompliance`
  tail replayed behind it. The stale broadcast cache has been deleted, cutting off further replays.
- **Not explained by replay: a second deployer key.** `FloorController 0xa21Ea231…` exists (4,698 B) but is
  absent from the nonce-0–60 sweep of `0xE0Dc…1E61` (nonce 59, so all its nonces are accounted for), so a
  different account created it. Its immutables are simulation values too: `registry()` = `0x28f9F554…`
  (which on chain holds a ModularCompliance, not a registry) and `vault()` = `0x77CC0a1d…`, no code.
  It is inert junk, and the live registry still shows only its constructor grants plus the single
  FACTORY_ROLE grant, so nothing stray holds privileges there.
- Non-finding: `ModularCompliance` exposes no `boundToken()` getter; that probe reverted and proves nothing.

Needs: owner — besides confirming the split build, please say **which key(s) were used** against 84532. If a
second key deployed anything privileged, its nonces should be swept before the fresh redeploy; that takes
minutes once the address is known.

## 2026-09-12 — contracts — CORRECTION to the forensics addendum: there is no second deployer key
Branch: main   Commit: (uncommitted — read-only)
Retracting the "second deployer key" claim in my previous entry. It was wrong, and the fault was in my
instrument, not the chain.

`FloorController 0xa21Ea231…` was created by `0xE0Dc359551aDe384cC4c90f89100016898aC1E61` — the same
deployer — at **nonce 57**. Confirmed twice: Blockscout attribution, and the creation transaction itself
(`0xcab92f19…`, from `0xE0Dc…1E61`, nonce 57, block 46701525).

Cause: my first sweep sent 61 `eth_getCode` calls in a single JSON-RPC batch. The public RPC rate-limited
the tail, and the code did `byId.get(i) || '0x'`, reading every dropped response as "no code at this
address". Nonce 57 fell in the dropped range, so missing data became a confident negative. The sweep now
chunks, verifies that every id returns, and fails loudly; the re-run surfaced the rate limiting at once.

**Complete verified inventory — 18 contracts, all from the one deployer, every nonce 0–58 accounted for:**
0 MockUSD · 1 AssetRegistry · 2–7 the six ComponentDeployers · 8 AssetFactory · 11 IdentityRegistry ·
15 MockUSD · 16 ModularCompliance · 17 CountryAllowModule · 18 TransferLockModule · 39 MockYieldSource ·
42 FloorController · 54 MockYieldSource · 57 FloorController.

The `MockYieldSource → FloorController` pair repeating at 39→42 and 54→57, three nonces apart each time,
is the script's post-factory tail (`_configureYield`, then `_configureFloor`) replayed twice with its
intervening calls — which corroborates the replay hypothesis rather than complicating it.

Everything else in the forensics stands: no `AssetContractsSet`, no `AssetSystemDeployed`, the single asset
is Approved with zero `contracts_`, the orphan is inert, and the recovery recommendation is unchanged —
(a) fresh redeploy after the split, plus the two cleanup transactions and the `DeployLocal` chain guard.
Needs: owner — (1) confirm the split build; (2) say **what commands** were run against 84532 (retries,
`--resume`, manual sends). Not *which keys*: there is only one deployer.

## 2026-09-12 — contracts — D-033 two-phase factory split landed; both chains now deployable
Branch: main   Commit: (uncommitted — owner commits on request)
Owner confirmed the split ("confirmed: build the two-phase factory split"). Built, tested, documented.

**Shape.** `deployAssetSystem` is retired (not repurposed — a name meaning "deployed and Active" must
not come to mean "half deployed"). Replaced by:
- `beginAssetSystem(params)` → token, vault, offering, revenue distributor; stores a
  `PendingDeployment{token,vault,offering,revenueDistributor,initiator,termsHash}`; asset stays Approved;
  emits `AssetSystemBegun`.
- `completeAssetSystem(assetId, params)` → redemption controller, pool, market manager, then
  `setAssetContracts`, `activateAsset`, D-032 full renounce, `AssetSystemDeployed` **once, in today's
  shape**.
- `abandonAssetSystem(assetId)` → phase-1 caller or factory admin; clears the record and renounces the
  factory's roles on the four orphans; registry admin then `closeAsset`. **No TTL** (recorded decision).
- New view `isPending(bytes32)`; new errors `AlreadyBegun` / `NotBegun` / `AssetIdMismatch`.

**Measured gas (mock pool, `test_eachPhaseFitsUnderBothChainGasCaps`): phase 1 = 8,538,854, phase 2 =
7,270,255.** Both under Hedera's 15,000,000; phase 2 leaves ~4.3M for the canonical pool's code deposit,
so the Base path lands near 11.6M against the 16,777,216 cap. The measurement is a test assertion, not a
comment, so it cannot rot silently.

**Architect refinements, both implemented.** (1) Phase 2 is bound to `pending.initiator`, not
`registry.issuerOf` — a re-assigned issuer cannot adopt someone else's half-built system; the window is
documented in `SECURITY.md`'s compliance section. (2) The vault's three unguarded inflows
(`depositInitialReserve`, `depositReserve`, `depositAssetRevenue`) now revert `SystemNotActive()`, and
the rule is in the **invariant** suite: `test/invariant/PendingSystemInvariants.t.sol` runs a prober that
is the asset's registry issuer, the phase-1 initiator (so the vault's immutable `issuer`) and the
configured `revenueDepositor` — every attempt clears the role and issuer checks, so only the new gate
stops it. 4,096 randomized calls, vault balance stays 0. Without the gate that invariant fails.

**One deliberate deviation from the agreed wording, flagged for the architect.** The rule was phrased
"vault inflows require Active". I implemented "revert while the asset is `Approved`" instead. Gating on
Active would also block `Suspended`, `Defaulted` and `Matured` — and a suspended asset in shortfall can
only be cured by an issuer deposit, while `resumeAsset` needs the shortfall cleared, so the literal
version deadlocks exactly the case D-023 enforcement exists for. `Approved` is precisely the unfinished
window: `Pending` cannot reach a vault, every later state means `activateAsset` ran. Covered both ways by
`test_depositsWorkOnceActiveAndStillWorkWhileSuspended`. Say if you want it stricter.

**Also in this change.** `DeployLocal` gained `require(block.chainid == 31337)` — it had no chain guard,
falls back to the public Anvil key #0, and its mock path (15.29M) would largely have succeeded on Base.
Both deploy scripts now call the two phases. Fixed stale doc rot found on the way: `CONTRACTS_TO_BACKEND`
§6 still told the backend the factory *keeps* `PAUSER_ROLE`/`KEEPER_ROLE` after handoff, which D-032 made
false — an "admin activity" view should now flag exactly the opposite.

Testing: **277 tests pass, 0 fail** (22 suites); `forge fmt --check` clean; via-IR still off (owner
preference) — no stack-too-deep, the phases are decomposed into helpers.

Interface changes: **CHANGED rows filed in `CONTRACTS_TO_FRONTEND.md` and `CONTRACTS_TO_BACKEND.md`.**
Backend event surface is unchanged — `AssetSystemDeployed` still fires once at completion in its existing
shape, so discovery needs no change. Backend should **not** move discovery to `AssetSystemBegun`: it
announces components for a system that may be abandoned. Frontend does not call the factory; no break.

Needs: backend — re-run `npm run sync-abis`; `backend/abis/AssetFactory.json` still lists
`deployAssetSystem`. Owner — the Base Sepolia broadcast hold can lift once this is committed; recovery
recommendation is unchanged: (a) fresh full redeploy, plus the two optional cleanup transactions
(`registry.closeAsset(0x618d32ff…)`, `registry.revokeRole(FACTORY_ROLE, 0xFEb03CF0…)`).

## 2026-09-12 — architect — LIVE on Base Sepolia (84532): deployment record committed
Branch: main   Commit: (this commit)
What: the owner broadcast DeployTestnet against real Base Sepolia after the D-033 split landed, and
it completed — the first successful ArcReserve deployment on a public chain. Committing
`contracts/deployments/84532.json` as the canonical record; every other stack reads addresses from
that file, never from chat or logs.
Verified by the architect directly against sepolia.base.org (not from broadcast artifacts): all
nine core contracts hold code (pool 22,142 B = real Uniswap V3, engine 16,709 B, vault 12,247 B);
`statusOf(0x618d32ff…75a9)` = 2 (Active) — the state no earlier attempt ever reached; all six
components registered in the registry; pool created by Uniswap's canonical factory
0x4752ba5D…aD24 at fee 3000, tick −276325 (≈1.000000 mUSD), observation cardinalityNext 900 (the
stepped growth under EIP-7825 worked); `redemptionReserve` = 20,000e6; `assetIsToken0` = true,
matching the pre-deploy prediction. Contract Arch's independent selector-level verification is
running separately.
Rehearsal calibration from Contract Arch (Anvil, --broadcast): begin 8,522,905 / complete
7,192,074 gas, within 1% of the test-measured 8,538,854 / 7,270,255. Both phases fit under
Hedera's 15,000,000 too, so 296 is unblocked whenever the owner wants it.
Chain hygiene note: an EARLIER failed deployment left ~18 orphan contracts and one
Approved-but-never-completed asset under the dead registry 0x481C18A9…6677 from the same deployer.
Indexers and any chain inspection must key off the NEW factory 0xaFB2329C…08BB. Cleanup
(closeAsset + revoke the dead factory's FACTORY_ROLE) is still pending.
Near miss worth recording: the pre-broadcast forensics led Contract Arch to flag 84532.json as a
simulation artifact and advise deleting it before broadcasting. It was in fact the real record —
the owner had broadcast during the rehearsal. It flagged rather than acted, and the architect
caught it by re-verifying against the chain. Lesson: verify state against the chain, not against
the plan, whenever a human may have acted between messages.
Interface changes: none.
Needs: owner — (1) grade the frontend comprehension answers, still the largest blocker; (2) decide
how judges get KYC-verified on 84532 (operator-run page vs pre-registered wallets vs a DemoRegistrar
contract allowing testnet self-registration) — without one, every judge wallet is unverified and
cannot buy.

## 2026-09-12 — frontend — D-035: rebuilt on React + Vite; routes, charts and writes NOT ported
Branch: feat/frontend   Commit: (this commit)
What: on owner instruction, `frontend/` is now a React 19 + Vite 8 SPA with Tailwind CSS v4,
shadcn/ui, Vitest + Testing Library, and a multi-stage Docker image behind nginx. The Next.js 15 App
Router implementation was removed from the working tree (it remains in git history).
Ported verbatim, because it encodes financial rules rather than framework choices: `lib/api.ts` (the
`{ data, meta }` envelope, `ApiError` codes), `lib/queries.ts` (`["api", route, …]` keys, sub-backend
`staleTime`), `lib/fixtures.ts`, `lib/data.ts`, `lib/format.ts`, `lib/contracts.ts`, `lib/wagmi.ts`,
and `DataSourceBadge` / `DataPanel`. The brand palette is carried into the Tailwind theme tokens, so
the product does not change appearance because the build tool did.
**Deliberately NOT ported, and therefore currently broken in the product:** the marketplace, asset,
issuer, verifier and engine routes; routing itself; the candle chart and the engine chart (Recharts
is no longer installed); and every wallet write — mUSD approval, buy, claim, redeem, issuer reserve
and revenue deposits, asset submission, verifier NAV/status actions, and keeper `slide` / `sweep` /
`rebalanceToNAV`. Those worked before this change. `docs/FRONTEND.md` §1 and §3 onward are retained
as their porting specification.
Verified: `tsc -b`, `eslint .`, `vitest run` (25 tests / 3 files), and `vite build` all pass; the dev
server serves 200 on port 3000. The Docker image was **not** built — no Docker daemon on this
machine — though `docker compose config` validates. Do not report the container as proven.
Interface changes (both boundary docs updated with CHANGED rows):
- **A (contracts→frontend):** every frontend env var renamed `NEXT_PUBLIC_*` → `VITE_*`, read through
  `import.meta.env`. No ABI, address, or `deployments/<chainId>.json` change. A future `sync-env.mjs`
  must emit `VITE_*`.
- **C (backend→frontend):** `NEXT_PUBLIC_API_URL` → `VITE_API_URL`. Envelope, routes, error codes and
  provenance rules unchanged. Backend needs no change: `CORS_ORIGIN` still defaults to
  `http://localhost:3000`, and the Vite dev server is pinned there with `strictPort` for exactly that
  reason.
Two traps for whoever ports the panels back: (1) Vite **inlines** `VITE_*` at build time, so they are
Docker build arguments, not runtime env — repointing the container means rebuilding it; (2)
`npx shadcn@latest add` currently mis-resolves the `@/lib/utils` alias and emits
`import { cn } from "cn"` while installing an unrelated `cn` package — rewrite the import and
`npm uninstall cn` (documented in `frontend/README.md`).
One pre-existing inaccuracy found while porting: `format.ts`'s `formatPercent` docstring claimed
`"1.80"` → `"+1.80%"`, but it trims trailing zeros and returns `"+1.8%"`. The docstring was wrong,
not the code; the docstring was corrected rather than the display behaviour changed, since changing
it is a UI decision.
Needs: owner — (1) confirm whether the ported routes should come back in the order given by
`AGENT_FRONTEND.md` tasks 0–4 (KYC gating first) now that they must be rebuilt anyway; (2) the
frontend comprehension answers are still ungraded, and the answer key entries 27 and 28 were amended
by this change.
