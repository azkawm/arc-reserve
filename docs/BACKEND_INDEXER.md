# Backend, Indexer, and OHLC Specification

Status: approved implementation direction. **Milestone A is implemented** in `backend/`
(workspace, validated configuration, migrations, chain-identity guards, `/v1/health`); milestones
B–E are still specification. Stack choices are fixed by D-030. See `backend/README.md` for how to
run it and what currently exists.

This specification is intentionally detailed enough for another agent to scaffold the service. It
must not be used to imply that current frontend metrics are indexed or live.

## 1. Goals

The backend should provide four capabilities:

1. **Chain indexer:** ingest ArcReserve and canonical-pool events into a reorg-safe store.
2. **Read model:** expose coherent asset, accounting, holder, and market views without forcing the
   browser to coordinate dozens of RPC calls.
3. **OHLC pipeline:** convert canonical pool swap prices into interval candles and volume.
4. **Operational visibility:** expose indexer lag, stale NAV, failed projections, and keeper-relevant
   safety status.

The backend is not a custodian. It must not hold user private keys or sign investor transactions.
User writes continue through the connected wallet. A future keeper worker requires separate scoped
keys, policy, and deployment approval.

## 2. Non-goals for the first backend milestone

- Implementing offering escrow or settlement contracts.
- Replacing contract authorization with API authorization.
- Computing legal ownership or offchain investor eligibility.
- Treating mock candles as onchain history.
- Running an autonomous market-making strategy.
- Serving as an NAV oracle signer.
- Hiding reorgs or failed RPC reads behind fabricated values.

## 3. Recommended hackathon architecture

Use a single TypeScript workspace initially:

```text
backend/
|-- package.json
|-- tsconfig.json
|-- .env.example
|-- migrations/
|-- src/
|   |-- config.ts
|   |-- server.ts
|   |-- db/
|   |   |-- client.ts
|   |   `-- schema.ts
|   |-- chain/
|   |   |-- client.ts
|   |   |-- addresses.ts
|   |   `-- abis.ts
|   |-- indexer/
|   |   |-- runner.ts
|   |   |-- backfill.ts
|   |   |-- live.ts
|   |   |-- reorg.ts
|   |   |-- decode.ts
|   |   `-- projections/
|   |-- candles/
|   |   |-- price.ts
|   |   `-- aggregate.ts
|   |-- api/
|   |   |-- routes/
|   |   `-- schemas/
|   `-- observability/
|       |-- health.ts
|       `-- metrics.ts
`-- test/
    |-- fixtures/
    |-- unit/
    `-- integration/
```

Suggested components:

- Node.js 20 or newer;
- TypeScript;
- viem for RPC, ABI decoding, and unit-safe primitives;
- Fastify for a small typed HTTP service;
- PostgreSQL 16 for durable event and candle history;
- a migration tool selected once and used consistently; and
- Zod or TypeBox for request/response validation.

For a one-machine demo, API, indexer, and candle worker may run in one process. Keep their modules and
database transactions separate so they can split later.

SQLite can be used for a temporary zero-infrastructure demo, but the schema must avoid SQLite-only
semantics if PostgreSQL is the intended deployment. Do not introduce both databases in the first PR.

## 4. Configuration

Proposed environment variables:

```text
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://...
CHAIN_ID=31337
RPC_HTTP_URL=http://127.0.0.1:8545
RPC_WS_URL=ws://127.0.0.1:8545
START_BLOCK=0
CONFIRMATIONS=0
POLL_INTERVAL_MS=1000
MAX_BLOCK_RANGE=2000
REGISTRY_ADDRESS=0x...
FACTORY_ADDRESS=0x...
MUSD_ADDRESS=0x...
ALLOW_MOCK_MARKET_DATA=false
```

Rules:

- Validate all configuration at startup and fail fast.
- Store addresses checksum-normalized for display and lowercase-normalized for lookup.
- Verify configured chain ID against RPC before indexing.
- Refuse to start production mode with `CONFIRMATIONS=0`.
- Do not bundle backend secrets into `NEXT_PUBLIC_*` variables.

## 5. Data provenance

Every public metric should have a provenance category:

| Provenance | Meaning |
| --- | --- |
| `onchain` | Direct state/event value from a specified chain/block |
| `derived` | Deterministic calculation from indexed onchain data |
| `mock` | Deliberate demo fixture that is not asserted as live |

Recommended response metadata:

```json
{
  "chainId": 31337,
  "indexedBlock": 123,
  "indexedBlockHash": "0x...",
  "asOf": 1786932000,
  "provenance": "derived",
  "stale": false,
  "lagBlocks": 0
}
```

`asOf` is the **chain timestamp of the indexed block in unix seconds**, matching the shared
timestamp convention, not an ISO string and not wall-clock time. `indexedBlockHash` and `asOf` are
`null` before the first block is indexed, and that state is always `stale: true`.
`docs/stacks/BACKEND_TO_FRONTEND.md` §1 is the authoritative form of this envelope.

Never return a mock number with `onchain` or `derived` provenance. Never replace a live-query error
with a fixture without changing the visible UI state.

## 6. Database model

Use integer/numeric storage for blockchain quantities. Do not store financial values as floating
point. Preserve raw base units and expose formatted strings at the API boundary.

### 6.0 Value domains (implemented)

Financial columns use two SQL domains rather than a bare numeric type:

```sql
CREATE DOMAIN uint256 AS NUMERIC CHECK (SCALE(VALUE) = 0 AND VALUE >= 0 AND VALUE <= 2^256-1);
CREATE DOMAIN int256  AS NUMERIC CHECK (SCALE(VALUE) = 0 AND VALUE BETWEEN -2^255 AND 2^255-1);
```

Deliberately **unconstrained** `NUMERIC`, not `NUMERIC(78,0)`: a typmod is applied before the
domain check, so `NUMERIC(78,0)` accepts `1.5` and silently stores `2`. With no typmod the value
keeps its scale and the check rejects it. This is the storage-level half of the no-floats rule;
`bigint` in application code is the other half.

`eth_address`, `eth_hash`, `eth_topic` and `eth_hexdata` domains enforce lowercase `0x` hex of the
right length, so a checksummed address can never become a second lookup key.

### 6.1 Chain integrity tables (implemented)

#### `chains`

| Column | Notes |
| --- | --- |
| `chain_id` | Primary key. CHECK constrains it to 31337 / 84532 / 296 (D-027) |
| `name` | Human-readable network |
| `finality_confirmations` | Applied confirmation depth |
| `registry_address`, `factory_address`, `stablecoin_address` | Deployment fingerprint. A process configured for different addresses on the same chain id is refused rather than interleaving two histories |
| `start_block` | Configured backfill origin |

#### `indexed_blocks`

| Column | Notes |
| --- | --- |
| `chain_id` | Composite primary key |
| `number` | Composite primary key |
| `hash` | Unique within chain |
| `parent_hash` | Reorg verification |
| `timestamp` | Chain timestamp |
| `canonical` | False after rollback, or delete in one transaction |

#### `raw_logs`

| Column | Notes |
| --- | --- |
| `chain_id` | Composite primary key |
| `transaction_hash` | Composite primary key |
| `log_index` | Composite primary key |
| `block_number` | Foreign key/checkpoint |
| `block_hash` | Detect orphaned logs |
| `address` | Emitting contract |
| `topic0..topic3` | Raw topics |
| `data` | Raw data |
| `event_name` | Nullable until decoded |
| `decoded` | JSON for diagnostics, not the only projection source |

#### `indexer_cursors`

| Column | Notes |
| --- | --- |
| `chain_id` | Primary key with worker name |
| `worker` | `arc-events`, `pool-swaps`, `candles`, etc. |
| `block_number` | Last committed block |
| `block_hash` | Must match before continuing |
| `block_timestamp` | Chain time of that block; the `asOf` in every response envelope |
| `reorg_depth` | Non-zero while recovering; surfaces as `degraded` in `/v1/health` |
| `last_error` | Last failure text, or null |
| `updated_at` | Liveness metric |

`raw_logs` carries a cascading foreign key to `indexed_blocks (chain_id, number)`, so deleting an
orphaned block deletes its logs in the same statement. That is the primitive the reorg rollback in
§8 is built on, and it also makes a log for an unindexed block impossible to write.

#### `projection_anomalies`

| Column | Notes |
| --- | --- |
| `id` | Surrogate key |
| `chain_id`, `block_number`, `transaction_hash`, `log_index` | Where the discrepancy was seen |
| `worker`, `kind` | e.g. `arc-events`, `allocation_balance_mismatch` |
| `detail` | JSONB: emitted value, applied value, category |
| `resolved` | Open anomalies make `/v1/health` report `degraded` |

Required by the projection rule in `CONTRACTS_TO_BACKEND.md` §2: when an applied delta disagrees
with the emitted new balance, **flag the row, never overwrite silently**. This table is evidence,
never trusted state.

### 6.2 Protocol projection tables (implemented)

Live in `migrations/*_projections.sql`. Two shapes, and the difference decides how a reorg is
undone (§8.4): **history** tables carry `(block_number, transaction_hash, log_index)` and cascade
from `indexed_blocks`; **current-state** tables (`token_supply`, `vault_balances`, `token_balances`,
`position_configs`, `identities`, `compliance_config`, `holder_locks`, `reserve_schedules`) are
incremental aggregates with no block key.

Added beyond the original list: `watched_addresses` (the discovered log filter),
`reserve_schedules` / `reserve_contributions` / `reserve_shortfall_events` (D-023), and
`token_supply` carrying all three denominators — `total_supply`, `excluded_supply` and
`issuer_allocation_supply` (D-024), from which `investorSupply` and `yieldEligibleSupply` are
derived. `identities` deliberately has no `is_verified` column.

Recommended tables:

- `assets`: identity, issuer, category, metadata, maturity, current status.
- `nav_history`: asset ID, block/log identity, old NAV, new NAV, timestamp.
- `asset_deployments`: token, vault, offering, market, revenue, redemption, and pool addresses.
- `offering_purchases`: buyer, stable amount, token amount, split values.
- `vault_allocations`: category, signed delta, new balance, total accounted.
- `revenue_deposits`: gross and four split amounts.
- `revenue_claims`: holder/operator, amount, cumulative totals where available.
- `redemptions`: holder, mode, token amount, mUSD amount, NAV, applied price.
- `position_configs`: asset, position kind, ticks, block/log identity.
- `position_liquidity_events`: add/remove, liquidity, amount0, amount1.
- `market_rebalances`: operation, spot, TWAP, NAV, resulting anchor range.
- `manager_swaps`: direction, amount in/out, price limit; useful for audit, not OHLC truth alone.
- `pool_swaps`: canonical pool swap price/tick/liquidity/amount data.
- `candles`: pair, interval, bucket, OHLC, volume, trades, source/finality.

Use foreign keys or application-level integrity so one series cannot accidentally join another
series' token, vault, or pool.

### 6.3 Candle primary key

```text
(chain_id, pool_address, interval_seconds, bucket_start)
```

Store:

- `open_raw`, `high_raw`, `low_raw`, `close_raw` as exact decimal/numeric values;
- `volume_asset_raw` and `volume_stable_raw` as base-unit integers;
- `trade_count`;
- first and last `(block_number, transaction_index, log_index)` ordering tuple;
- `finalized`; and
- `source` (`canonical_swap` or explicit `mock`).

## 7. Event ingestion map

### Registry

- `AssetSubmitted`: create identity projection.
- `AssetStatusChanged`: update status and append lifecycle history.
- `NAVUpdated`: append NAV history and update current NAV/timestamp.
- `AssetContractsSet`: attach component addresses.
- `OraclePolicyUpdated`: update registry policy history.

### Factory

- `PoolFactoryApprovalChanged`: administrative audit history.
- `AssetSystemDeployed`: confirm the complete deployment tuple and issuer.

### Token

- ERC-20 `Transfer`: supply and holder-balance projection if needed.
- `RevenueDistributorSet`: configuration audit.
- AccessControl events: optional role audit projection.

### Vault

- `AllocationChanged`: canonical category ledger projection.
- `InitialReserveDeposited`.
- `IssuerProceedsWithdrawn`.
- `ProtocolFeesWithdrawn`.
- `RedemptionReleased`.
- `MarketFundsReleased` and `MarketFundsReturned`.

`AllocationChanged` includes the new category balance and total accounted. Projectors should verify
that applying the signed delta produces the emitted new balance. Flag, do not hide, any mismatch.

### Offering

- `TokensPurchased`: buyer, token output, and exact 70/20/10 values.

### Revenue

- `RevenueDeposited`.
- `RevenueClaimed`.
- `OperatorRevenueClaimed`.
- `YieldExclusionChanged`.

### Redemption

- `Redeemed`.
- `EmergencySettlementPriceSet`.
- `RedemptionPeriodReset`.

### Market manager

- `PositionConfigured`.
- `PositionLiquidityAdded`.
- `PositionLiquidityRemoved`.
- `FeesCollected`.
- `Rebalanced`.
- `SwapExecuted`.
- `MarketAllocationFunded`.
- `TokenInventoryFunded`.
- `SafetyPolicyUpdated`.

### Canonical pool

For production OHLC, index the canonical pool's `Swap` event including `sqrtPriceX96`, `liquidity`,
and `tick`. Also ingest `Initialize`, `Mint`, `Burn`, and `Collect` when position/fee analytics require
them.

The current `MockUniswapV3Pool` does not emit these canonical events and does not change price during
`swap`. `AssetMarketManager.SwapExecuted` contains amounts but not the post-swap tick. It cannot by
itself produce trustworthy OHLC.

## 8. Idempotency and reorg handling

### 8.1 Ordering

Apply logs in strict order:

```text
block number -> transaction index -> log index
```

The raw-log unique key makes retries idempotent. Projection updates and cursor advancement must commit
in one database transaction per block or small atomic range.

### 8.2 Startup algorithm

1. Read the cursor.
2. Fetch the RPC block at the cursor number.
3. Compare its hash with the stored cursor hash.
4. If equal, continue from the next block.
5. If different, walk backward until a common ancestor is found.
6. Roll back projections and raw logs after the ancestor.
7. Reprocess canonical blocks forward.

### 8.3 Live algorithm

1. Determine safe head: `latest - confirmations`.
2. Fetch a bounded block range and all watched-address logs.
3. Fetch block headers for parent/hash/timestamp integrity.
4. Decode known events; preserve unknown raw logs.
5. Apply projections in order.
6. Upsert candles affected by swaps in those blocks.
7. Commit raw logs, projections, blocks, and cursor atomically.
8. Emit lag and error metrics.

For Anvil, confirmation depth may be zero. For public networks, choose finality based on the target
chain and show provisional data separately when indexing the non-finalized tip.

### 8.4 Rolling back is a rebuild, not an inverse (implemented)

The projection tables come in two shapes, and only one of them can be rolled back by deletion:

- **History** (`token_transfers`, `vault_allocations`, `nav_history`, ...) is keyed by block and
  cascades from `indexed_blocks`, so an orphaned block takes its rows with it.
- **Current-state aggregates** (`token_supply`, `vault_balances`, `token_balances`,
  `position_configs`, `identities`, `compliance_config`) are *incrementally maintained* and carry no
  block key at all. A balance is the sum of everything that ever happened to it. Deleting the
  reorged blocks does nothing to them.

Writing a correct inverse for every projector — six kinds of arithmetic, in reverse, including two
flag events that move a denominator with no `Transfer` — is exactly the sort of code that is wrong
in a way nobody notices. Instead the read model is treated as a **pure function of the canonical log
sequence**: after rolling back to the common ancestor, the projections are cleared and the surviving
`raw_logs` are replayed in chain order. The logs above the ancestor are already gone, so what
remains *is* the canonical history.

Cost: one full re-projection per reorg. On a demo chain, milliseconds. The optimisation for a long
chain is periodic snapshots of the current-state tables, rebuilding from the newest snapshot below
the ancestor instead of from genesis.

A divergence deeper than the search window (default 256 blocks) is **refused**, not resolved: an
indexer that silently rewrites unbounded history is worse than one that stops and reports.

### 8.5 Never read a cached head

`viem`'s `getBlockNumber` caches for `cacheTime`, which defaults to the polling interval (4s). An
indexer that reads a cached head concludes there is nothing new, skips blocks that already exist,
and reports a lag that is an artefact of its own cache. The chain client sets `cacheTime: 0`.

## 9. Price conversion

For a canonical V3 pool:

```text
raw token1/token0 = (sqrtPriceX96 / 2^96)^2
human token1/token0 = raw ratio * 10^(token0 decimals - token1 decimals)
```

Then:

- if asset is token0 and stable is token1, stable-per-asset is the human ratio;
- if stable is token0 and asset is token1, stable-per-asset is the reciprocal.

Use integer or arbitrary-precision decimal math. Do not use JavaScript `number` for base-unit or
Q64.96 calculations.

As a validation path, compare the latest derived pool price with
`AssetMarketManager.marketPrices().spotPrice`. The manager value is six-decimal mUSD per token for the
configured pair.

## 10. OHLC aggregation

For each interval and pool, bucket by chain timestamp:

```text
bucketStart = floor(blockTimestamp / intervalSeconds) * intervalSeconds
open  = first swap price by chain ordering
high  = maximum swap price
low   = minimum swap price
close = last swap price by chain ordering
```

Recommended intervals for the MVP:

- 60 seconds;
- 300 seconds;
- 900 seconds;
- 3,600 seconds;
- 14,400 seconds;
- 86,400 seconds.

Volume:

- normalize signed pool amounts to absolute input/output quantities;
- record both asset and stable raw volume;
- do not double-count a swap by summing both sides as independent trades; and
- keep fee estimates separate from volume.

Empty buckets should normally be omitted. The API may forward-fill a display close only when it marks
`tradeCount: 0` and does not invent high/low volume.

Reorg rollback must delete or rebuild every candle whose contributing swap was orphaned.

## 11. Derived read models

### Asset summary

Return separately:

- identity, metadata commitment, issuer, status, maturity;
- current NAV and update timestamp;
- spot and TWAP with source block;
- protected reserve and market allocation;
- total accounted and actual vault balance;
- reserve ratio and minimum ratio;
- issued, excluded, eligible circulating, and maximum supply;
- normal redemption price and available liquidity;
- offering raised/sold/inventory;
- position ranges and recorded liquidity; and
- stale/safety state.

Do not call `issuedSupply - companyVesting` “circulating” unless the contract's actual exclusion state
supports that calculation.

### Protected floor reference

Prefer reading `RedemptionController.redemptionPrice(Normal)` at the indexed block. When deriving:

```text
min(current NAV, redemptionReserve * 1e18 / totalSupply)
```

Handle zero supply explicitly. Include the formula inputs in debug/admin responses.

### Position liquidity

The manager's `positions(kind)` value is the canonical recorded liquidity for MVP views. Token
composition in a real V3 position depends on current price and liquidity math; do not infer mUSD/token
amounts from `uint128 liquidity` by treating it as a token amount.

## 12. HTTP API proposal

Version all routes under `/v1`.

| Route | Purpose |
| --- | --- |
| `GET /v1/health` | Process, database, RPC, chain, cursor, and lag status |
| `GET /v1/assets` | Paginated asset discovery |
| `GET /v1/assets/:assetId` | Identity and deployment summary |
| `GET /v1/assets/:assetId/metrics` | NAV, prices, floor, reserve, supply, offering metrics |
| `GET /v1/assets/:assetId/activity` | Unified event timeline |
| `GET /v1/assets/:assetId/positions` | Four position records and latest actions |
| `GET /v1/assets/:assetId/candles` | OHLC by interval/range |
| `GET /v1/assets/:assetId/redemptions` | Aggregate/history page |
| `GET /v1/assets/:assetId/revenue` | Deposits, claims, and split totals |
| `GET /v1/accounts/:address/assets/:assetId` | Indexed holdings and claim/redemption context |

Example candle query:

```text
GET /v1/assets/0x.../candles?interval=3600&from=...&to=...&limit=500
```

Example response shape:

```json
{
  "data": [
    {
      "timestamp": 1786932000,
      "open": "0.978000",
      "high": "0.990000",
      "low": "0.974000",
      "close": "0.984000",
      "volumeAsset": "1250.000000000000000000",
      "volumeStable": "1229.500000",
      "tradeCount": 12,
      "finalized": true
    }
  ],
  "meta": {
    "chainId": 31337,
    "indexedBlock": 123,
    "provenance": "derived",
    "source": "canonical_swap"
  }
}
```

Use decimal strings in JSON for exact financial quantities.

## 13. Frontend integration contract

The frontend should use TanStack Query for API reads and wagmi for wallet writes. Recommended rules:

- backend reads provide indexed historical and aggregate data;
- direct contract reads provide wallet-sensitive or execution-critical confirmation;
- transaction previews re-read current onchain state before write;
- a submitted transaction is shown as pending until indexed or sufficiently confirmed;
- stale backend data displays its indexed block/time;
- error state does not silently become fixture state; and
- demo fixtures remain accessible only behind an explicit demo flag or badge.

## 14. Operational endpoints and metrics

`/v1/health` should report:

- configured and RPC chain IDs;
- database connectivity;
- latest RPC block;
- latest indexed block and hash;
- block/time lag;
- last successful index time;
- current reorg depth if recovering;
- watched contract count;
- candle worker cursor; and
- current status: healthy, degraded, or unhealthy.

Track counters for RPC failures, decode failures, reorgs, rolled-back blocks, projection failures, and
candle rebuilds.

## 15. Test plan

### Unit

- ABI decode fixtures for every projected event.
- Price conversion for both token orderings and 6/18-decimal combinations.
- Candle boundaries, ordering, volume, and empty-bucket behavior.
- Signed allocation delta handling.
- Status and position projection reducers.

### Database integration

- Reprocessing the same range creates no duplicates.
- Cursor and projections commit atomically.
- Rollback removes orphaned projections and rebuilds candles.
- Unique constraints reject duplicate logs.
- Multiple asset systems never cross-associate addresses.

### Anvil integration

- Deploy the current script and discover component addresses.
- Index a purchase, revenue deposit, claim, redemption, and market update.
- Restart the indexer and resume from the cursor.
- Rewind/revert Anvil state and verify common-ancestor recovery where tooling permits.

### Canonical-pool fork

- Decode real Swap events.
- Confirm price conversion against pool reads.
- Aggregate OHLC across multiple swaps in the same block.
- Verify both token orderings.

## 16. Security requirements

- No private keys in the API process for the first milestone.
- Strict address, asset ID, interval, range, and pagination validation.
- Bounded RPC block ranges and response sizes.
- Rate limits on public endpoints.
- Parameterized database queries.
- Structured logging without secrets.
- CORS restricted by environment.
- Health endpoints must not expose credentials.
- Contract allowlists derived from registry/factory events, not arbitrary request addresses.
- Unknown or undecodable events retained for diagnosis but never projected as trusted state.

## 17. Milestones and acceptance criteria

### Milestone A: foundation — **done (2026-08-27)**

- backend workspace, config validation, database migration, health route;
- chain identity check; and
- block/raw-log/cursor tables.

Delivered on branch `backend/foundation`: validated configuration that refuses a non-testnet chain,
a zero root address, and `CONFIRMATIONS=0` in production; PostgreSQL migrations with the value
domains above; the four-step startup guard (RPC identity, deployment presence, database
fingerprint, cursor hash) including fresh-chain-restart detection; `GET /v1/health`; and 80 tests
covering exact-decimal arithmetic, the envelope rules, schema integrity against a real PostgreSQL,
and the guards. Run instructions in `backend/README.md`.

### Milestone B: ArcReserve indexer — **done (2026-08-30)**

- registry and deployment discovery;
- event ingestion and projections;
- restart-safe cursor; and
- reorg rollback tests.

Delivered: address discovery from `AssetSystemDeployed` / `IdentityRegistryAdded` /
`ComplianceAdded` / `ModuleAdded` (only three addresses are configured); kind-keyed decoding so the
shared `Transfer` selector cannot confuse an 18-decimal asset movement with 6-decimal mUSD;
projections for identity, lifecycle, NAV, the three supply denominators, holders, the five vault
categories, the D-023 reserve schedule, purchases, revenue, redemptions, positions, rebalances and
ERC-3643 state; one transaction per block; and reorg recovery by rebuilding the read model from the
surviving logs (see §8.4). Acceptance is `backend/test/integration/replay.test.ts` and
`reorg.test.ts`, both against a live Anvil.

**Not projected, deliberately:** `isVerified`, NAV staleness, offering open/closed and reserve
shortfall are functions of `now()` and are computed at query time; under D-023 a shortfall can begin
with no transaction at all. Position token amounts are not derived from `uint128 liquidity`.

### Milestone C: read API

- asset list/detail/metrics/activity/positions endpoints;
- exact decimal-string serialization; and
- provenance and freshness metadata.

### Milestone D: OHLC

- canonical Swap ingestion or explicit synthetic-demo adapter;
- candle aggregation and rebuild;
- candle endpoint; and
- frontend candle migration.

### Milestone E: frontend migration

- replace fixture metrics incrementally;
- keep clear mock badges for remaining fixtures;
- loading/error/stale states; and
- transaction-to-indexer reconciliation.

The backend milestone is complete only when a fresh database can replay a seeded deployment into the
same deterministic read model and recover correctly after restart and a simulated reorg.

