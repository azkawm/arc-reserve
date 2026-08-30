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
