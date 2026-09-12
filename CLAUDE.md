# ArcReserve Agent Handoff

This file is the primary context document for Claude Code, Codex, or another implementation agent.
Read it before changing the repository. Then follow the links to the detailed specifications.
A human taking over the project starts with `HANDOVER.md` at the repository root.

Before material implementation, complete [`docs/AI_COMPREHENSION_CHECK.md`](docs/AI_COMPREHENSION_CHECK.md)
and present the answers to the project owner. This is a required context check, not a coding task.

## Mission

ArcReserve is a hackathon MVP for launching verified real-world asset participation markets. Each
asset series combines:

- a capped ERC-20 token;
- a category-accounted stablecoin vault;
- an initial offering;
- revenue distribution to yield-eligible circulating holders;
- reserve-limited redemption;
- a guarded concentrated-liquidity manager; and
- an issuer, verifier, investor, and keeper interface.

The demonstration series is **Solar Indonesia 01 (SOLAR01)**. The product tagline is **Real assets.
Programmable liquidity.**

This is infrastructure and product-prototype software. It does not itself establish legal title,
equity, a guaranteed return, a price peg, or guaranteed 1:1 redemption.

## Scope: hackathon only

**ArcReserve is a hackathon submission, not a production system.** Every agent must keep this
framing (D-027):

- Deployment targets are **Anvil (31337)** for local work, **Base Sepolia (84532)** and
  **Hedera testnet (296)** for the demo. No mainnet, no real funds, no real investors. Stablecoin is
  `MockUSD` on every target.
- "Institution-grade" flows (KYC, maker–checker, term-sheet binding, reserve schedule) are
  **design demonstrations**, not certified compliance. Copy must say "demo" / "testnet" wherever a
  real product would say "regulated".
- No audit has been performed. Coverage is not an audit. A single admin key per chain is
  acceptable for the demo; the multisig/timelock story is documented, not deployed.
- Anvil private keys are never used on Base Sepolia or Hedera; funded testnet keys live only in
  untracked `.env` files.
- Anything that would require a legal entity, licence, custodian, or audited financials is out of
  scope and must be labelled as such in the UI and docs.

**Scope is limited; quality is not.** "Hackathon" bounds *what* we build (testnets, mock
stablecoin, no legal wrapper), never *how well*. The bar for every stack:

- Contracts: every financial rule tested (unit + invariant), `forge fmt` clean, no untested
  branches in money-moving paths, explicit errors, events for every state change, NatSpec on every
  external function.
- Backend: typed end-to-end, exact decimal arithmetic, idempotent and reorg-safe by test, health
  and provenance on every response, replayable from a fresh DB.
- Frontend: typecheck/lint/build clean, no hardcoded financial literals, every number traceable
  to a read or a labelled fixture, real loading/error/stale states, wallet flows that confirm on
  receipt, accessible and responsive, copy that reads like a product — not a prototype.
- Docs: updated in the same change; a stranger can run the demo on all three chains from the
  runbook alone.

If a shortcut is unavoidable, it is labelled in code (`// DEMO:`), in the UI, and in
`docs/DECISIONS.md` — never silent. Judges should see a small system built to a production
standard, not a large one built to a demo standard.

## Non-negotiable product rules

Do not weaken these rules without an explicit product decision and corresponding test changes:

1. **Supply is capped.** SOLAR01 is not an unlimited-supply token.
2. **The market manager cannot mint.** It trades only inventory transferred to it.
3. **Protected reserve and market inventory are different accounting buckets.** Market making may
   withdraw only the vault's market allocation.
4. **NAV, market spot, protected floor reference, and redemption price are distinct values.**
   (Four since D-036 removed TWAP from the engine; the principle is unchanged — the remaining four
   must never be collapsed into one another.)
5. **Redemption is reserve-limited.** It is not an always-on promise to redeem at NAV.
6. **Asset tokens burn before stablecoin leaves the vault during redemption.**
7. **Revenue uses yield-eligible circulating supply.** Yield-excluded vesting balances do not dilute
   active holders and cannot earn retroactive revenue when released.
8. **Price appreciation is not protocol profit.** Only realized revenue, fees, settlement proceeds,
   or realized rebalancing surplus can be allocated.
9. **Hikari is a lifecycle reference, not code to clone.** ArcReserve borrows the UX concepts of
   anchor movement and discovery refresh, not Hikari's uncapped minting or bonding-curve AMM.
10. **UI policy previews must be labeled.** Do not present a target feature as onchain-enforced when
    the corresponding contract does not exist.
11. **The token is permissioned.** Every non-exempt transfer leg must pass the identity registry.
    Only infrastructure that is not an investor (canonical pool, market manager, vesting wallet)
    may be compliance-exempt, and a burn (redemption exit) is never blocked by a stale KYC claim.

## Current repository state

| Layer | Status | Notes |
| --- | --- | --- |
| Solidity contracts | Implemented | Foundry project under `contracts/` |
| Local deployment | Implemented | Anvil deployment script and deterministic mock pool |
| Contract tests | Implemented | 247 passing tests at the last verification (2026-08-30, after task 10) |
| Transfer compliance | Implemented | ERC-3643-shaped `IdentityRegistry` + `ModularCompliance`; token checks both legs of every transfer; pool and market manager are exempt infrastructure |
| Market-manager coverage | Strong | 98.28% lines, 95.44% statements, 73.47% branches, 100% functions (2026-09-11) |
| Frontend | Migrated to the API | Marketplace and asset page read `/v1` with a provenance badge per panel; issuer/verifier/engine panels still fixtures. See `docs/FRONTEND.md` §3 |
| Wallet writes | Partially live | Buy, claim, redeem, issuer actions, verifier actions, and keeper range calls. Unchanged by the API migration: writes still go through the wallet |
| Market data | Live except the chart | Metrics, reserves, supply, positions and holdings come from `/v1`. Candles stay `mock`-badged on Anvil |
| Backend API | Implemented | `backend/` (D-030): the full `/v1` read API — assets, metrics, positions, activity, revenue, redemptions, candles, per-account. Provenance envelope on every response; 175 tests |
| Chain indexer | Implemented | Event ingestion, address discovery, 23 projection tables, restart-safe cursor, reorg rollback + rebuild. Verified against a live Anvil replay and an `evm_revert` reorg |
| Canonical OHLC | Implemented | Canonical `Swap` ingestion and candle aggregation; the mock pool emits canonical events since task 10. Anvil candles are still badged `mock` — a linear stand-in, not price discovery |
| Escrowed fundraising | Target only | Current offering mints immediately on each purchase |
| Threshold settlement | Target only | Full/partial/failed settlement rules exist only in specification and UI preview |
| Company vesting | Removed from the product (D-031) | No issuer token allocation; the issuer is paid in cash. `CompanyVestingWallet` still exists as an unused primitive and `setYieldExcluded` is still used for excluded addresses |
| Controlled issuance headroom | Target only | Cap exists, policy controller does not |
| Lock and earn | Target only | UI preview and business rules only |

## Working per stack

One agent per stack: read `docs/stacks/README.md`, then the brief for your stack
(`AGENT_CONTRACTS.md`, `AGENT_BACKEND.md`, `AGENT_FRONTEND.md`) and the boundary docs that touch it.
Interface changes are announced in the boundary doc in the same change. Kickoff prompts are in
`docs/stacks/PROMPTS.md`; cross-session messages go in `docs/stacks/HANDOFF_LOG.md`; the reasoning
behind settled decisions is in `docs/DESIGN_RATIONALE.md` — do not re-litigate it in code.

## Source-of-truth order

When sources disagree, use this order:

1. Solidity implementation and passing tests.
2. `docs/SYSTEM_SPEC.md` and `docs/DECISIONS.md`.
3. Other files in `docs/`.
4. Frontend copy and `frontend/src/lib/data.ts`.

Frontend fixture values illustrate the intended UX and are not authoritative protocol state.

## Repository map

```text
arc-reserve/
|-- CLAUDE.md                         This handoff
|-- README.md                         Human-oriented project entry point
|-- contracts/
|   |-- src/                          Solidity implementation
|   |-- script/DeployLocal.s.sol      Seeded Anvil deployment
|   |-- test/unit/                    Component and control tests
|   |-- test/integration/             Lifecycle and market happy paths
|   |-- test/invariant/               Stateful financial invariants
|   `-- deployments/31337.json        Last local addresses; regenerate after Anvil restart
|-- frontend/
|   |-- src/app/                      Marketplace, asset, engine, issuer, verifier routes
|   |-- src/components/               Charts, transaction panels, controls, shared UI
|   |-- src/lib/contracts.ts          Minimal ABIs and environment addresses
|   `-- src/lib/data.ts               Explicit demo fixtures
|-- backend/                          Indexer and read API (milestones A-E)
|   |-- migrations/                   Plain SQL, run by node-pg-migrate (D-030)
|   |-- abis/                         Snapshot of contracts/out, via npm run sync-abis
|   |-- src/config.ts                 Validated environment; refuses non-testnet chains
|   |-- src/chain/identity.ts         Startup guards and fresh-chain detection
|   `-- src/api/                      /v1 routes, envelope, Zod response schemas
`-- docs/
    |-- SYSTEM_SPEC.md                Canonical implementation-level specification
    |-- ARCHITECTURE.md               Components, trust boundaries, and flows
    |-- BUSINESS_MODEL.md             Target commercial and settlement model
    |-- MARKET_MAKING.md              ARC liquidity engine and Hikari mapping
    |-- BACKEND_INDEXER.md            Planned API, indexer, and OHLC design
    |-- FRONTEND.md                    Current UI behavior and integration plan
    |-- TESTING.md                     Test map, commands, coverage, and gaps
    |-- DECISIONS.md                   Accepted decisions and open questions
    |-- AI_COMPREHENSION_CHECK.md      Pre-implementation questions and answer key
    |-- SECURITY.md                    Threat model and pre-production requirements
    |-- USER_FLOWS.md                  Formal issuer/verifier/investor/keeper flows
    |-- DESIGN_RATIONALE.md            Why decisions were made; verified vs assumed
    `-- stacks/                        Boundary docs, agent briefs, PROMPTS.md, HANDOFF_LOG.md
    |-- PRD.md                         Product requirements and acceptance criteria
    `-- DEMO.md                        Local demo runbook
```

## Demo configuration

The local script deploys one series with these values:

| Parameter | Value |
| --- | --- |
| Token | SOLAR01, 18 decimals |
| Stablecoin | mUSD, 6 decimals, test faucet |
| Maximum token supply | 100,000 SOLAR01 |
| Offering inventory | 80,000 SOLAR01 |
| Company/issuer token allocation | None (D-031). The issuer is paid in cash; 20,000 SOLAR01 stays unminted headroom |
| Offering price | 1.000000 mUSD per SOLAR01 |
| Fundraising cap | 80,000 mUSD |
| Wallet purchase limit | 50,000 mUSD |
| Minimum purchase | 1 mUSD |
| Initial protected reserve | 20,000 mUSD |
| Minimum reserve ratio | 20% of NAV-valued investor supply |
| Reserve schedule (D-023) | Backing 0.30 -> 1.00 mUSD per investor token over three years, 30-day grace |
| Maturity | Deployment time plus three years |
| Revenue split | 60/25/10/5 on schedule; 40/45/10/5 while backing is behind schedule (D-023) |
| Reporting cadence | Revenue report every 30 days, 30-day grace before `isReportingOverdue()` |
| Reserve yield | `MockYieldSource` seeded with 5,000 mUSD; credits reserve while behind schedule, issuer otherwise |
| Maturity window | 90 days after maturity to redeem at par, then residual reserve returns to the issuer |
| Published floor (D-025) | `FloorController` starts at ~0.2983 mUSD/token, ratchets one tick spacing (~0.6%) per `levelUp()`, 30-minute cooldown |
| Primary purchase split | 65% issuer / 30% reserve / 5% market allocation (D-023) |
| Redemption period | One day |
| Redemption limit | 25,000 SOLAR01 per period |
| Verified wallets | Anvil #0 deployer (institutional), Anvil #1 investor (accredited), Anvil #2 (retail) — country 360, no expiry |
| Class caps (D-028) | Retail 5,000 mUSD / accredited 50,000 / institutional uncapped within the raise |
| Compliance modules | `CountryAllowModule` (Indonesia only), `TransferLockModule` (hold period 0) |
| NAV stale threshold | Two days |
| Maximum NAV move | 20% per update |
| Market TWAP window | 30 minutes |
| Rebalance cooldown | 30 minutes |
| Maximum spot/TWAP deviation | 3% |
| Maximum TWAP/NAV deviation | 20% |
| Maximum range move | 1,200 ticks |

The script mints nothing at deploy time (D-031). Total supply starts at zero, `PrimaryOffering` is
the only holder of `ISSUANCE_CONTROLLER_ROLE`, and of the 100,000 authorized supply 80,000 is
offering inventory while 20,000 remains unminted headroom.

## Contract model in one page

### Registry and factory

`AssetRegistry` owns asset identity, metadata commitment, NAV, maturity, lifecycle status, and the
addresses of deployed components. `AssetFactory` may deploy a system only for an approved record,
from an approved pool factory, and only for the registered issuer. Component deployers keep factory
runtime bytecode below the EIP-170 limit.

Asset status is:

```text
Pending -> Approved -> Active -> Suspended -> Active
   |                      |          |
   `-> Closed             |          `-> Defaulted
                          |-> Defaulted
                          `-> Matured -> Closed
```

Some transitions are implemented as dedicated functions rather than a generic state machine. Read
`AssetRegistry.sol` before adding a transition.

### Token and supply

`AssetToken` is ERC-20 Permit plus pause and roles. The offering is the normal issuance controller.
The redemption controller is the only component allowed to burn another holder's tokens. Supply may
never exceed `maximumSupply`.

Transfers are permissioned (ERC-3643 function names). `AssetToken._update` checks, in order:
sender/recipient address freeze, partial-freeze balance, `identityRegistry.isVerified` for each
non-exempt leg (burns skip the sender check), then `compliance.canTransfer`. `transferRestriction()`
returns the selector of the first failing rule for UI previews. `TRANSFER_AGENT_ROLE` may freeze and
`forcedTransfer`. The factory binds the shared `IdentityRegistry` and exempts the pool and market
manager; `ModularCompliance` (per token) with `CountryAllowModule` / `TransferLockModule` is bound
post-deploy by the admin. See `src/compliance/`.

Under D-031 the issuer receives no token allocation: nothing is minted at deploy time, the offering
is the only holder of `ISSUANCE_CONTROLLER_ROLE`, and `CompanyVestingWallet` remains only as an
unused primitive. The `issuerAllocation` flag (D-024) still exists for any future flagged address:
flagged balances leave `investorSupply()` and can never redeem against the reserve.

### Vault accounting

The vault tracks five categories:

```text
redemptionReserve
+ marketMakingAllocation
+ assetRevenue
+ issuerProceeds
+ protocolFees
= totalAccounted
```

Required solvency:

```text
stablecoin balance >= totalAccounted
redemptionReserve >= minimumRequiredReserve

minimumRequiredReserve = NAV value of investor supply * minimum reserve ratio
investor supply        = totalSupply - issuerAllocationSupply   (D-024; equal to totalSupply in the demo)
```

Direct token transfers to the vault are unaccounted until an authorized function credits a category.

### Offering

The current `PrimaryOffering` is a direct purchase contract, not escrow. A successful `buy` transfers
mUSD to the vault, accounts it 65/30/5 (issuer/reserve/market, D-023), and immediately mints tokens
to the buyer. It enforces per-class purchase caps from the identity registry (D-028) and checks time,
asset status, fundraising cap, wallet limit, inventory, minimum purchase, and minimum token output.

The target full/partial/failed fundraising settlement in `BUSINESS_MODEL.md` is not implemented.

### Revenue and vesting eligibility

`RevenueDistributor` uses a cumulative-revenue-per-eligible-token accumulator. The token calls its
transfer hook before every mint, burn, or transfer so past revenue remains with the economic holder
who earned it. An excluded address has zero eligible balance and its holdings are tracked in
`excludedSupply`.

Excluding an account does not erase revenue already earned. Removing exclusion starts the balance at
the current accumulator, preventing retroactive yield.

### Redemption

Normal redemption is allowed only while active, maturity redemption only while matured, and emergency
redemption only while suspended or defaulted. The price is:

```text
liquid backing per token = redemption reserve / investor supply
reference = emergency settlement price when set in emergency mode, otherwise NAV
redemption price = min(reference, liquid backing per token)
```

In Maturity mode the reference is additionally capped at par: `reference = min(NAV,
vault.maturityParValue())`, where par is the D-023 schedule's end target (normally 1.000000 mUSD).
SOLAR01 is a note, so backing above par is not holder upside. Maturity redemption is open only
until `vault.maturityWindowEndsAt()` (demo: 90 days after maturity), and reverts
`MaturityWindowClosed()` after that. Once the asset is `Closed` and the window has passed, the
issuer's `releaseResidualReserve()` returns only the reserve above
`investorSupply * min(NAV, par)`, so remaining holders keep full par cover.

The period limit and reserve liquidity are checked before the token burns and the vault pays.

### ARC Liquidity Engine

The manager records four Uniswap V3-style positions: reserve-floor range, anchor, discovery, and
optional intermediary. The reserve-floor range is market inventory and is not the protected floor
reference.

Range updates follow an explicit keeper lifecycle:

```text
remove old liquidity -> verify safety -> update range -> remint in a second transaction
```

The three Hikari-inspired happy paths are:

- `slide`: move an empty anchor after an upward spot/TWAP signal;
- `sweep`: move an empty anchor after a downward signal; and
- `refreshDiscovery`: move an empty discovery range.

This manager does not implement Hikari's bonding curve, dynamic minting, or automatic reserve
borrowing. See `docs/MARKET_MAKING.md`.

## Frontend truth boundary

The frontend intentionally mixes executable controls and visual fixtures.

Live when contract addresses and a wallet are configured:

- mUSD approval;
- offering purchase;
- holder revenue claim and claimable read;
- normal redemption;
- issuer reserve deposit and revenue deposit;
- asset submission;
- verifier NAV/status actions; and
- keeper `slide`, `sweep`, and `rebalanceToNAV` calls.

Mock or static today:

- OHLC candles and period switching;
- spot, TWAP, NAV, and floor numbers shown in most cards;
- market list and issuer profile;
- liquidity balances and ranges;
- keeper history;
- portfolio balances and protocol statistics;
- sell execution; and
- full/partial offering settlement preview.

`frontend/src/lib/data.ts` is the fixture source. Do not call it indexed or live data.

The candle chart uses Recharts with a custom candle shape. TradingView Lightweight Charts is not
installed. A future chart should consume indexed canonical pool swaps as specified in
`docs/BACKEND_INDEXER.md`.

## Backend and indexer: next major subsystem

`backend/` is built through Milestone E: event ingestion with reorg-safe rollback, the `/v1` read
API, the OHLC pipeline, and the frontend migration onto it. Read `backend/README.md` for the route
table and `docs/BACKEND_INDEXER.md` for the design. Two rules it enforces and any change must keep:
a failed live read becomes an error state, never a fixture; and a value that is a function of *now*
— KYC verification, NAV staleness, offering openness, reserve shortfall, floor coverage — is
computed per request, never projected.

Key requirements:

- idempotent log ingestion keyed by chain, transaction hash, and log index;
- block-hash checkpoints and reorg rollback;
- derived views for assets, supply, reserve buckets, revenue, redemptions, and liquidity positions;
- canonical-pool swap ingestion for OHLC;
- explicit data provenance (`onchain`, `derived`, or `mock`);
- no backend-held user signing keys; and
- frontend fallback that never silently substitutes mock data for failed live data.

Since contracts task 10 the mock pool emits canonical Uniswap `Swap` events, so one keeper swap
produces real `canonical_swap` candles; until a swap happens on a fresh deploy, `/candles` returns
503 `MOCK_DISABLED` unless the explicitly labeled synthetic feed is enabled. The mock pool models
only a linear stand-in price impact — no impact curve, tick crossing, fee growth, MEV, or
liquidity exhaustion — so its candles are honest records of demo swaps, not price discovery.

## Commands

PowerShell examples from the repository root:

```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe build
C:\Users\willi\.foundry\bin\forge.exe test
C:\Users\willi\.foundry\bin\forge.exe coverage --report summary
```

If Foundry is on `PATH`, use `forge` directly.

Local demo:

```powershell
anvil
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
```

Frontend:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd run <script>` on this Windows machine.

Anvil addresses are ephemeral. Regenerate the deployment and update `.env.local` after restarting a
fresh chain. The checked-in `deployments/31337.json` may describe an older local run.

## Tests and validation baseline

Last contract verification:

- 247 tests passed (2026-09-11, re-verified on `main`);
- zero failures and zero skips;
- seven stateful financial invariants;
- `AssetMarketManager`: 98.28% lines, 95.44% statements, 73.47% branches, 100% functions;
- `AssetToken` (with compliance gate): 96.24% lines, 92.78% statements, 80.00% branches;
- `AssetVault`: 88.64% lines, 60.53% branches; `RedemptionController`: 90.28% lines, 41.18%
  branches; `AssetRegistry`: 84.21% lines, 20.00% branches — the weakest branch coverage is now
  in these money paths, logged as quality-bar debt; and
- overall Solidity sources: 85.17% lines, 84.33% statements, 59.05% branches, 85.41% functions
  (measured 2026-09-11).

Last frontend verification: `npm.cmd run typecheck`, `npm.cmd run lint`, and
`npm.cmd run build` all passed. Next.js generated the marketplace, asset, engine, issuer, and verifier
routes successfully.

Coverage is not an audit. The local pool is a callback harness, not an economic AMM simulator.

See `docs/TESTING.md` before changing financial or market behavior. Preserve unrelated user changes.

## Implementation priorities

Reprioritized 2026-08-27 (see D-022–D-024 and `docs/stacks/AGENT_CONTRACTS.md`): the contracts
track now runs the business-model alignment (company-token treatment, sinking-fund reserve
schedule, dynamic split, reserve yield, residual return, 65/30/5) **in parallel** with the backend
track below. Frontend tasks 0–2 in `docs/stacks/AGENT_FRONTEND.md` need neither.

Backend track order:

1. Backend/indexer foundation and schema.
2. Event ingestion with reorg-safe cursors.
3. Read APIs for assets, metrics, positions, and activity.
4. Canonical or explicitly synthetic OHLC pipeline.
5. Frontend migration from fixtures to provenance-labeled queries.
6. Production Uniswap V3 fork tests and position fee accounting.
7. Escrowed fundraising and deterministic full/partial/failed settlement.
8. Governed issuance headroom (factory-integrated company vesting is dropped under D-031).
9. Lock-and-earn funded only by realized stablecoin revenue or fees.

Do not combine steps 7-9 into the current direct offering without a migration and accounting plan.

## Known pitfalls

- `redemptionReserve` is not spendable market liquidity.
- `market floor range` is not the protected floor reference.
- The current offering is immediate minting, despite target fundraising copy in parts of the UI.
- `CompanyVestingWallet` exists but nothing wires it: the issuer receives no token allocation
  (D-031). Do not resurrect vesting flows without a new decision.
- `contracts/deployments/31337.json` is a snapshot, not a durable address registry.
- `EngineControls` uses a fixed tick pair suitable only for the seeded demo and may revert after a
  previous range update or when token ordering differs.
- Sell is intentionally not implemented in the frontend.
- Frontend mojibake was cleaned up; a byte scan on 2026-08-27 found only valid UTF-8 punctuation in
  `frontend/src`. Keep files UTF-8 when editing on Windows.
- The mock pool models only a linear stand-in price impact — no impact curve, tick crossing, fee
  growth, MEV, or liquidity exhaustion.
- `collectFees` cannot separate fees from principal at the generic manager interface level.
- A paused market still permits authorized liquidity removal, fee collection, and return of idle mUSD.
  This is intentional recovery behavior.
- Solidity and stablecoin decimals differ. Token amounts are 18 decimals; mUSD, NAV, and quoted prices
  use 6 decimals in the current system.

## Definition of done for future changes

A change is complete only when:

1. implementation and UI labels agree about whether behavior is live, derived, or mock;
2. financial category movements are explicit and tested;
3. authorization and pause behavior are tested;
4. relevant unit, integration, and invariant tests pass;
5. frontend typecheck, lint, and build pass for UI changes;
6. documentation updates distinguish current implementation from target policy; and
7. no claim of ownership, guarantee, peg, or dividend is introduced without legal/product approval.
