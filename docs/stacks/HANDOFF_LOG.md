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
