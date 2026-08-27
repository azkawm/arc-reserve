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
| B — ArcReserve event ingestion, restart-safe cursor, reorg rollback | Not started |
| C — read API with the provenance envelope | Not started |
| D — OHLC (synthetic on Anvil, canonical `Swap` where a real pool exists) | Not started |
| E — frontend migration off fixtures | Not started |

`/v1/health` is the only route that exists. Nothing is indexed yet, and the envelope says so:
`indexedBlock: 0`, `indexedBlockHash: null`, `stale: true`.

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

## Database

One database serves every chain; `chain_id` is on every row. Schema in
`migrations/*_chain-integrity.sql`:

| Table | Purpose |
| --- | --- |
| `chains` | Chain identity, confirmation depth, and the deployment fingerprint |
| `indexed_blocks` | `(chain_id, number)` with hash and parent hash — the reorg checkpoint |
| `raw_logs` | `(chain_id, transaction_hash, log_index)` — the idempotency key |
| `indexer_cursors` | `(chain_id, worker)` with the checkpointed block hash |
| `projection_anomalies` | Flagged discrepancies. Evidence, never silently corrected state |

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
npm run db:up
npm run test
```

80 tests: exact-decimal arithmetic, configuration validation, envelope and provenance rules,
schema integrity against a real PostgreSQL (domains, idempotent ingestion, cascade rollback,
atomic cursor advancement, multi-chain isolation), the startup guards, and the health route.

The integration suite **fails loudly** when no database is reachable rather than skipping — a
silently skipped integrity test is worse than a red one.
