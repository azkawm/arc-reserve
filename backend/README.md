# ArcReserve backend and indexer

Read-only chain indexer, read API, and OHLC service for the ArcReserve demo.

**Hackathon scope (D-027).** Testnets only: Anvil `31337`, Base Sepolia `84532`, Hedera testnet
`296`. `MockUSD` on all three. No mainnet, no real funds, no audit. The service holds **no keys and
never signs**: every user write goes through the connected wallet.

Design: [`../docs/BACKEND_INDEXER.md`](../docs/BACKEND_INDEXER.md).
Input contract (events, scales): [`../docs/stacks/CONTRACTS_TO_BACKEND.md`](../docs/stacks/CONTRACTS_TO_BACKEND.md).
Output contract (`/v1` shapes): [`../docs/stacks/BACKEND_TO_FRONTEND.md`](../docs/stacks/BACKEND_TO_FRONTEND.md).

## Status

| Milestone | State |
| --- | --- |
| A — workspace, config validation, migrations, chain identity check, `/v1/health` | **Done** |
| B — ArcReserve event ingestion, restart-safe cursor, reorg rollback | **Done** |
| C — read API with the provenance envelope | Not started |
| D — OHLC (synthetic on Anvil, canonical `Swap` where a real pool exists) | Not started |
| E — frontend migration off fixtures | Not started |

`/v1/health` is still the only route. The indexer runs in the same process and fills the read
model; the data routes that expose it are Milestone C.

## Quick start

```powershell
cd backend
npm install
Copy-Item .env.example .env      # deterministic fresh-Anvil addresses are already filled in
npm run db:up                    # PostgreSQL 16 in Docker on 127.0.0.1:5450
npm run migrate
npm run dev                      # http://127.0.0.1:4000/v1/health
```

The chain must be reachable before the server will listen. In another terminal:

```powershell
anvil
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
```

If PowerShell blocks `npm.ps1`, use `npm.cmd run <script>`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API in watch mode (indexer and candle worker join this process in B and D) |
| `npm run build` / `npm start` | Compile to `dist/`, run the compiled server |
| `npm run migrate` | Apply migrations (`node-pg-migrate`, plain SQL files) |
| `npm run migrate:down` | Roll back the last migration |
| `npm run db:up` / `db:down` | Start / stop the bundled PostgreSQL |
| `npm run db:reset` | Drop the volume, recreate, migrate — the fresh-chain recovery path |
| `npm run test` | Unit + database integration (needs `db:up`) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint |
| `npm run sync-abis` | Re-copy ABIs from `../contracts/out` after a `forge build` |

## Configuration

Every variable is validated at startup and the process **refuses to run** on anything invalid —
see `.env.example` for the annotated list. The rules worth knowing:

- `CHAIN_ID` must be `31337`, `84532` or `296`. A mainnet id is rejected by config *and* by a
  database CHECK constraint.
- `REGISTRY_ADDRESS` / `FACTORY_ADDRESS` / `MUSD_ADDRESS` must be non-zero and must have code on
  the chain. Per-asset component addresses are **discovered** from `AssetSystemDeployed`, never
  configured.
- `CONFIRMATIONS=0` is refused when `NODE_ENV=production`.
- `ALLOW_MOCK_MARKET_DATA` gates synthetic candles. Default `false`. A mock value is never served
  as `onchain` or `derived` (D-019).

## Startup guards

The failure this service is built to prevent: Anvil restarts, every address changes, and the
indexer keeps writing to a database that describes a chain which no longer exists — producing a
read model that looks healthy and is entirely fictional. So startup checks, in order:

1. **RPC identity** — `eth_chainId` must equal `CHAIN_ID`.
2. **Deployment presence** — the three root addresses must have code.
3. **Database fingerprint** — the `chains` row stores the registry, factory and stablecoin
   addresses. A different deployment under the same chain id is refused with `npm run db:reset`.
4. **Cursor hash** — the stored block hash must still match the chain. Hash changed but contracts
   present ⇒ an ordinary reorg (rolled back in Milestone B). Hash changed *and* registry code
   empty ⇒ the chain was replaced ⇒ refuse to run.

Each failure exits with an operator message and a hint, never a stack trace.

## The indexer

One pass: reconcile the cursor against the chain, then walk forward from `cursor + 1` to
`latest - CONFIRMATIONS` in `MAX_BLOCK_RANGE` chunks. Backfill and live tailing are the same
code path — "live" is just a short range. Each block commits in **one transaction** carrying its
raw logs, every projection they produce, the block row and the cursor.

**Idempotency is structural.** A log is inserted into `raw_logs` keyed by
`(chain_id, transaction_hash, log_index)` with `ON CONFLICT DO NOTHING`, and projected *only when
that insert created a row*. That is what makes the incremental arithmetic — balances, the three
supply denominators, vault category balances, position liquidity — safe to replay.

**Discovery, not configuration.** Only the registry, factory and mUSD addresses are configured.
Component addresses come from `AssetSystemDeployed`; the identity registry and compliance contract
come from the token's own `IdentityRegistryAdded` / `ComplianceAdded`; modules come from
`ModuleAdded`. Since a range can contain the deployment that introduces addresses whose components
emit in that same block, a range whose watched set grew is simply replayed with the larger filter —
idempotent, so it costs one RPC round trip and converges.

**Decoding is keyed by address kind, not by topic0.** `Transfer` on the asset token and `Transfer`
on mUSD are byte-identical selectors; resolving through the watched set makes confusing an
18-decimal asset movement with a 6-decimal mUSD one impossible rather than merely unlikely. A log
whose selector is unknown for its kind is archived with `event_name = NULL` and never projected.

### Reorg recovery

`evm_revert`-style history changes are handled by rolling back to the common ancestor and
**re-deriving the read model from the surviving logs**. The reason is worth stating: history tables
cascade away with their block, but the current-state aggregates (`token_supply`, `vault_balances`,
`token_balances`, `position_configs`, `identities`) are incremental and carry no block key —
deleting orphaned blocks does nothing to them. Rather than write a correct inverse for every
projector, the projection is treated as a pure function of the canonical log sequence: clear, then
replay what survived (`src/indexer/rebuild.ts`). On a long chain the optimisation is periodic
snapshots; on a demo chain it is milliseconds.

A divergence deeper than the search window (256 blocks) is refused, not resolved. An indexer that
silently rewrites unbounded history is worse than one that stops and says so.

## Database

One database serves every chain; `chain_id` is on every row. Schema in
`migrations/*_chain-integrity.sql` and `*_projections.sql`:

| Table | Purpose |
| --- | --- |
| `chains` | Chain identity, confirmation depth, and the deployment fingerprint |
| `indexed_blocks` | `(chain_id, number)` with hash and parent hash — the reorg checkpoint |
| `raw_logs` | `(chain_id, transaction_hash, log_index)` — the idempotency key |
| `indexer_cursors` | `(chain_id, worker)` with the checkpointed block hash |
| `projection_anomalies` | Flagged discrepancies. Evidence, never silently corrected state |
| `watched_addresses` | The discovered log filter: roots plus every component found in an event |
| `assets`, `asset_deployments`, `nav_history`, `asset_status_history` | Identity and lifecycle |
| `token_supply`, `token_balances`, `token_transfers` | Holders and the three denominators |
| `vault_balances`, `vault_allocations`, `reserve_schedules`, `reserve_contributions`, `reserve_shortfall_events` | The five-category ledger and the D-023 schedule |
| `offering_purchases`, `revenue_deposits`, `revenue_claims`, `redemptions` | Money in and out |
| `position_configs`, `position_liquidity_events`, `market_rebalances`, `manager_swaps` | ARC engine |
| `identities`, `compliance_config`, `holder_locks` | ERC-3643 state |

### Three supply denominators, never interchangeable

```text
total_supply           every minted token
investor_supply        total_supply - issuer_allocation_supply   backing, redemption (D-024)
yield_eligible_supply  total_supply - excluded_supply            revenue (D-006)
```

Both flag events — `IssuerAllocationChanged` and `YieldExclusionChanged` — move a denominator with
**no `Transfer` event at all**, so each adjusts its aggregate directly from the balance the contract
reports. A projection keyed only on transfers would silently drift.

### What is never stored

`isVerified` is `registered && (expiresAt == 0 || expiresAt > now)` — a function of the current
time. Storing it would produce an API correct at index time and wrong the moment a claim expired.
The same applies to NAV staleness, whether an offering is open, and reserve-schedule shortfall:
under D-023 a shortfall can begin **with no transaction at all**, because the target backing rises
with time. All of these are computed at query time from stored inputs.

Position **token amounts** are also absent: `uint128 liquidity` cannot be converted to
mUSD/SOLAR01 without a real curve, so the raw value is stored and the conversion is not attempted.

Two details carry weight:

- `raw_logs` has a cascading foreign key to `indexed_blocks`, so deleting an orphaned block
  deletes its logs in the same statement — the primitive reorg rollback is built on.
- The `uint256` / `int256` domains are **unconstrained** `NUMERIC` with a `SCALE(VALUE) = 0`
  check, not `NUMERIC(78,0)`. A typmod is applied *before* the domain check, so `NUMERIC(78,0)`
  silently rounds `1.5` to `2`; the unconstrained form rejects it. No float can enter the ledger
  through a column of these types.

## Money

No floats, anywhere. Values are `bigint` base units in code, `NUMERIC` in the database, and
**decimal strings** in JSON. `src/lib/decimal.ts` mirrors the contracts' rounding (`mulDiv` floors,
including for negative quotients) so a derived value equals the onchain one rather than landing one
base unit away. ESLint blocks `parseFloat` and `Math.round`.

Scales: asset tokens 18d; mUSD, NAV, prices, spot, TWAP and redemption price 6d; bps `10_000 = 100%`.

## Provenance

Every `/v1` response carries `meta.provenance`:

| Value | Meaning |
| --- | --- |
| `onchain` | Read from an event or a view call at a stated block |
| `derived` | Deterministically computed from indexed onchain data |
| `mock` | A deliberate demo fixture, only when `ALLOW_MOCK_MARKET_DATA=true` |

A failed live read becomes an error, never a fixture. `/v1/health` is labelled `derived`: it is
this service's own operational state, not a chain value.

## Tests

```powershell
npm run db:up                    # PostgreSQL
anvil                            # in another terminal
cd ../contracts; forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
cd ../backend; npm run test
```

105 tests: exact-decimal arithmetic, configuration validation, envelope and provenance rules, log
decoding, schema integrity against a real PostgreSQL (domains, idempotent ingestion, cascade
rollback, atomic cursor advancement, multi-chain isolation), the startup guards, the health route,
and two suites against a live chain.

The chain suites are deliberately not mocked:

- **`replay.test.ts`** indexes a seeded `DeployLocal` chain into a fresh database and compares
  every projection against **the contracts' own view functions at that block** — supply
  denominators, all five vault categories, the reserve schedule, positions, identities. Not against
  constants copied from a document: `§7` of `CONTRACTS_TO_BACKEND.md` still describes the
  pre-D-031 seed, and a hardcoded expectation would have gone stale twice in one week.
- **`reorg.test.ts`** makes a real purchase, rewinds the chain with `evm_revert`, and asserts the
  *projected* purchase is gone — supply, vault reserve and history all back to their prior values,
  then re-converging on a replacement branch that carries the same purchase.

Both suites **fail loudly** when Postgres or Anvil is unreachable rather than skipping. A silently
skipped acceptance test is worse than a red one.
