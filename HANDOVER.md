# ArcReserve — Handover

> For the incoming maintainer. Written 2026-09-05 from `main`. This page tells you what exists,
> what is verified, what remains, and how to take ownership without breaking the working
> agreements. Everything here is expanded elsewhere — this is the map, not the territory.

## 1. What this is, in three sentences

ArcReserve is a hackathon RWA protocol: an issuer raises capital against a verified real-world
asset (demo: a solar project, SOLAR01) by selling a **KYC-permissioned, capped revenue-participation
token**. Investors receive 60% of gross-revenue deposits, can always exit against a protected
stablecoin reserve at `min(NAV, backing)`, and the issuer must refill that reserve to 1.00 per token
by maturity on an onchain-enforced schedule with a published, ratchet-only price floor. Scope is
testnet-only (Anvil 31337, Base Sepolia 84532, Hedera testnet 296) with a mock stablecoin —
**hackathon scope, production quality bar** (D-027, `CLAUDE.md`).

## 2. Verified state (dates matter — re-verify, don't trust)

| Claim | Verified | How to re-verify |
| --- | --- | --- |
| Contracts: **247 tests, 0 failed** (20 suites incl. invariants) | 2026-09-05 | `cd contracts && forge test` (`C:\Users\willi\.foundry\bin\forge.exe` if not on PATH) |
| Backend: milestones A–E done, suite green, live-Anvil replay + `evm_revert` reorg recovery | 2026-08-30 (agent log) | `cd backend && npm run test` (needs PostgreSQL; `docker-compose.yml` provided) |
| Frontend: typecheck/lint/build clean after Milestone E migration | 2026-08-30 (agent log) | `cd frontend && npm.cmd run typecheck && npm.cmd run lint && npm.cmd run build` |
| Local demo end-to-end | 2026-08-30 | `docs/DEMO.md` (note §7 below — parts are stale vs D-031) |

## 3. Current state per stack

### Contracts — complete against the decided model
All ten planned tasks are merged: ERC-3643-shaped compliance (identity registry, modular
compliance, freeze/forced transfer, exempt pool + market manager), investor-supply denominator,
sinking-fund reserve schedule with shortfall enforcement, dynamic revenue split with period-tagged
deposits, reserve-yield hook, residual return + 90-day maturity window, 65/30/5 settlement split,
`FloorController` (ratchet floor, one tick spacing per `levelUp`, 30-min cooldown), term-sheet hash
binding, class-based purchase caps, canonical `Swap` events from the mock pool, demo liquidity
seeding, and full factory role renunciation (D-032).

**Model change to internalise: D-031 — the issuer receives NO token allocation.** The issuer is
paid in cash (65% of the raise + 10% operator share of revenue). Company vesting is out of the
product; `CompanyVestingWallet` remains only as an unused primitive. Older docs mentioning a
20,000-token vesting allocation are historical.

### Backend — complete
`backend/`: validated config that refuses non-testnet chains; node-pg-migrate migrations (D-030);
23 projection tables; single-transaction-per-block ingestion with a restart-safe cursor, reorg
rollback, and fresh-Anvil detection; the full `/v1` read API with a provenance envelope
(`onchain`/`derived`/`mock`), Zod-validated responses, and decimal-string money; OHLC from
canonical swaps plus an explicitly `mock` synthetic feed behind `ALLOW_MOCK_MARKET_DATA`. Route
table and operations notes: `backend/README.md`.

### Frontend — half migrated
Done: marketplace and asset page read `/v1` with a provenance badge per panel; no `NEXT_PUBLIC_API_URL`
⇒ labelled fixture mode; failed request ⇒ named error, never a fixture (D-019). See
`docs/FRONTEND.md` §3 for the live-vs-mock table.
**Not done:** issuer, verifier, and engine pages are still fixtures (including hardcoded keeper
ticks); there is **no KYC gating** — an unverified wallet clicking Buy gets a raw revert instead of
an explanation (`transferRestriction` is exposed by the contracts exactly for this); no frontend
test runner.

### Docs — the asset that makes this handover possible
`docs/DECISIONS.md` D-001–D-032 (every product decision, dated), `docs/DESIGN_RATIONALE.md`
(alternatives rejected + a verified-vs-assumed table), `docs/stacks/` (boundary docs with dated
`CHANGED` rows, one brief per stack, kickoff prompts, `HANDOFF_LOG.md` — the append-only journal of
every task done so far), `docs/USER_FLOWS.md`, `docs/AI_COMPREHENSION_CHECK.md` (40 questions +
answer key).

## 4. What is NOT built

| Item | Where specified | Size |
| --- | --- | --- |
| **Escrowed offering** with ≥100% / >50% / ≤50% settlement and refunds — the last gap between contracts and the business model | D-007/D-008, `BUSINESS_MODEL.md` §Offering | Large |
| **Frontend: KYC gating** (task 0 of the brief) | `docs/stacks/AGENT_FRONTEND.md` | Small, high value |
| **Frontend: issuer / verifier / engine migration** off fixtures; derive keeper ticks from `/positions` | same brief, task 2/4 | Medium |
| **Testnet deployments** — no `deployments/84532.json` or `296.json` yet; two unknowns must be verified first (Base Sepolia Uniswap V3 factory address; Hedera EVM version) | D-027; `DESIGN_RATIONALE.md` §10 | Medium |
| Frontend test runner (Vitest) | brief | Small |
| Lock-and-earn; issuance-headroom controller | D-012; `BUSINESS_MODEL.md` | Large, lowest priority |
| Doc drift sweep: `docs/DEMO.md` still stages vesting scenes removed by D-031; comprehension answers 31–40 partially predate D-031 | this file §7 | Small |
| Open parameters: reserve-yield source (mock today), escrow details (exactly-50%, issuer rejection, oversubscription) | `DECISIONS.md` §Open | Decisions, not code |

Recommended order: KYC gating → remaining frontend migration → testnet deploys → escrowed
offering → the rest.

## 5. Taking ownership — the onboarding gate

Do these in order; do not skip 5:

1. Clone; `git submodule update --init` (forge-std v1.9.7, OpenZeppelin v5.1.0).
2. Read, in order: `CLAUDE.md` → `docs/stacks/README.md` → `docs/DECISIONS.md` →
   `docs/DESIGN_RATIONALE.md` → the brief for your stack in `docs/stacks/`.
3. Run all three verification suites (§2 table).
4. Run the local demo end-to-end: `anvil`, deploy per `docs/DEMO.md` §4, start the backend
   (`docker compose up -d && npm run migrate && npm run dev`), start the frontend with
   `NEXT_PUBLIC_API_URL` set, buy/claim/redeem with Anvil #1.
5. Complete `docs/AI_COMPREHENSION_CHECK.md` — all 40 questions and the scenarios — and have
   your answers graded against Part B before you change code. This is the gate that catches
   confident misreadings; every agent so far has gone through it.
6. Announce yourself in `docs/stacks/HANDOFF_LOG.md` (there is a format block at the top) and
   state which stack(s) you now own.

## 6. Working agreements (how changes are made here)

- **Decisions**: anything that changes the product model becomes a `D-0xx` entry in
  `docs/DECISIONS.md` *before* the code. Do not re-litigate settled decisions in code — if you
  disagree, open it in `HANDOFF_LOG.md` (see `DESIGN_RATIONALE.md` for why each one won).
- **Interfaces**: any change to a signature, event, or API shape adds a dated `CHANGED` row to the
  relevant `docs/stacks/CONTRACTS_TO_*.md` / `BACKEND_TO_FRONTEND.md` **in the same commit**.
- **Quality bar** (`CLAUDE.md` §Scope): green suites, fmt/lint clean, events for every state
  change, no silent shortcuts — label them `// DEMO:` in code and log them.
- **Non-negotiables** (`CLAUDE.md`): capped supply, market manager can't mint, reserve ≠ market
  inventory, five values stay distinct, burn-before-pay, provenance never lies, permissioned token.
- One task per commit; append a `HANDOFF_LOG.md` entry when a task completes.

## 7. Environment quirks (Windows machine this was built on)

- Git may refuse with "dubious ownership" — add `safe.directory` entries for the repo and both
  submodule paths (`git config --global --add safe.directory <path>`).
- PowerShell may block `npm.ps1` — use `npm.cmd run <script>`.
- Foundry lives at `C:\Users\willi\.foundry\bin\forge.exe` if not on PATH.
- `.gitattributes` pins LF; ignore CRLF warnings.
- Anvil addresses die with the chain: after every fresh `anvil`, redeploy, then re-sync
  `frontend/.env.local` and the backend addresses from `contracts/deployments/31337.json`.
- Start `anvil` from a normal terminal and leave it open. An Anvil launched from an agent tool
  session is killed when that session's process tree is cleaned up — mid-deploy or mid-test — which
  surfaces as `fetch failed` / `ECONNREFUSED` on 8545 rather than as an obvious crash.
- Anvil keys never leave Anvil; testnet deployer keys go in untracked `.env` files only.

## 8. Known stale spots (honesty section)

- `docs/DEMO.md`: scenes 3/5 still assume the removed vesting allocation (D-031) and the old
  70/20/10 split; the cast-call section is fine. Rework is on the to-do list.
- `docs/TESTING.md`: baseline updated to 247, but the per-suite table only covers the original 9
  suites — the newer suites live in `contracts/test/`.
- The suite counts and "verified" claims in §2 age from the moment this file was written:
  re-run, don't cite.
- `frontend/src/lib/data.ts` fixtures are still the fallback for fixture mode — they illustrate,
  they are not canonical numbers.

## 9. Who to ask

The decision history and rationale are in the docs; the previous owner (repo: `azkawm`) holds the
open-parameter decisions in `DECISIONS.md` §Open decisions. Cross-stack questions that the docs
don't answer go in `HANDOFF_LOG.md` under `Needs:` — that is the protocol, not a formality.
