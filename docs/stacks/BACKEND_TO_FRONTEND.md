# Boundary C — Backend → Frontend

The HTTP contract between the `backend/` service and the frontend app (React + Vite since D-035). This is the
file both agents code against. The backend agent owns it; the frontend agent may propose fields.
Everything here is **target** until the backend milestone C ships; until then the frontend keeps
its fixtures, labeled `mock`.

Frontend base URL env var: `VITE_API_URL` (e.g. `http://127.0.0.1:4000`). Absent → the app
runs in fixture mode and every backend-sourced panel shows a `Mock` badge.

## 1. Envelope

Every `/v1` response:

```json
{
  "data": { ... } | [ ... ],
  "meta": {
    "chainId": 31337,
    "indexedBlock": 1234,
    "indexedBlockHash": "0x…" | null,
    "asOf": 1786932000 | null,
    "provenance": "onchain" | "derived" | "mock",
    "stale": false,
    "lagBlocks": 0
  }
}
```

`indexedBlockHash` and `asOf` are `null` **only** before the first block is indexed, and that state
always carries `stale: true` (CHANGED 2026-08-27). Reporting `indexedBlock: 0` as fresh would let
the UI present an empty read model as current chain state.

Errors: HTTP 4xx/5xx with `{ "error": { "code": "ASSET_NOT_FOUND" | "INDEXER_BEHIND" | "MOCK_DISABLED" | "BAD_REQUEST" | "INTERNAL", "message": "…" } }`.
An unknown route is `404` with `BAD_REQUEST`; a rate-limited request is `429` with `BAD_REQUEST`.

Rules (from D-019):
- All financial quantities are **decimal strings in human units** (`"1.018000"`, `"20000.000000"`),
  plus the raw base-unit string where the UI might transact (`"raw": "1018000"`).
- `provenance` is per response; fields with a different provenance carry their own
  `{ value, provenance }` object (used for `mock` OHLC in an otherwise `derived` response).
- `stale: true` when `now - asOf > staleAfterSeconds` (default 60s on Anvil); UI shows a Stale badge.
- The frontend never substitutes a fixture for a failed request. Failed → error state.

## 2. Routes

| Route | Purpose | Replaces fixture |
| --- | --- | --- |
| `GET /v1/health` | status, chain ids, DB, cursors, lag | — |
| **`?chainId=`** on every asset route | selects the chain; defaults to the single chain in the database | — |
| `GET /v1/assets?status=&limit=&cursor=` | marketplace list | `marketPipeline` |
| `GET /v1/assets/:assetId` | identity + deployment | `solarAsset` (identity fields) |
| `GET /v1/assets/:assetId/metrics` | current numbers | `solarAsset` (numeric fields), all `Metric` cards |
| `GET /v1/assets/:assetId/candles?interval=&from=&to=&limit=` | OHLC | `priceHistory` |
| `GET /v1/assets/:assetId/nav-history?from=&to=` | NAV line | `priceHistory[].nav` |
| `GET /v1/assets/:assetId/positions` | 4 positions + last actions | `liquidityPositions`, `engine-chart` bands |
| `GET /v1/assets/:assetId/activity?type=&limit=&cursor=` | unified timeline | `rebalances`, asset "Activity" tab |
| `GET /v1/assets/:assetId/redemptions` | aggregates + history | — |
| `GET /v1/assets/:assetId/revenue` | deposits, claims, splits | issuer revenue panel |
| `GET /v1/accounts/:address/assets/:assetId` | holdings + claim/redeem context | "Your position" card |

`:assetId` is the bytes32 hex; the frontend may also resolve `slug` via `/v1/assets`.

`GET /v1/health` is shipped (Milestone A). Its payload is documented in `backend/README.md`; the
fields the UI needs are `data.status`, `data.chain.latestBlock`, `data.indexers[].blockNumber`, and
`meta.indexedBlock` for the transaction-reconciliation poll in section 5. Two deliberate
departures from the rules above (CHANGED 2026-08-27):

- it returns the **data envelope in every case**, including failure, because an operator reading
  it needs the detail rather than an opaque error body; and
- its HTTP status is a readiness signal — `200` while healthy or degraded, `503` once unhealthy —
  so a probe and the UI poll can both use it.

Its `meta.provenance` is `derived`: health is this service's own operational state, never a chain
value.

## 3. Shapes

### 3.1 `GET /v1/assets` item
```ts
{
  assetId: `0x${string}`; slug: string; name: string; symbol: string; category: string;
  status: "Pending"|"Approved"|"Active"|"Suspended"|"Defaulted"|"Matured"|"Closed";
  issuer: `0x${string}`;
  spot: { value: string; provenance: "onchain"|"derived"|"mock" } | null;
  floor: string | null;         // redemptionPrice(Normal), human 6d
  reserve: string | null;       // redemptionReserve, human
  change24h: string | null;     // signed percent "1.80" — null when no candles
  contracts: { token; vault; offering; marketManager; revenueDistributor; redemptionController; pool } | null;
}
```
Replaces `marketPipeline[]`: `price/floor/reserve/change` were pre-formatted strings — the UI now
formats. `accent` and `href` are frontend concerns derived from `category` and `slug`.

### 3.2 `GET /v1/assets/:assetId/metrics`
```ts
{
  nav:            { value: string; raw: string; timestamp: number; stale: boolean };
  spot:           { value: string; raw: string; sourceBlock: number } | null;
  twap:           { value: string; raw: string; windowSeconds: number } | null;
  floorReference: { value: string; raw: string; formula: "min(nav, reserve/supply)" };
  redemptionPrice:{ normal: string | null; maturity: string | null; emergency: string | null };
  reserve: {
    redemptionReserve: string; marketMakingAllocation: string; assetRevenue: string;
    issuerProceeds: string; protocolFees: string; totalAccounted: string; vaultBalance: string;
    reserveRatioBps: string | null; minimumReserveRatioBps: number; minimumRequiredReserve: string;
    isSolvent: boolean; availableRedemptionLiquidity: string;
  };
  supply: {
    maximum: string; issued: string; excluded: string; eligibleCirculating: string;
    headroom: string;                 // maximum - issued
    vesting: { address: `0x${string}`; balance: string; released: string; start: number; end: number } | null;
  };
  offering: { price: string; raised: string; cap: string; sold: string; inventory: string;
              walletLimit: string; minimumPurchase: string; startsAt: number; endsAt: number; open: boolean };
  redemption: { periodStartedAt: number; periodDuration: number; redeemedThisPeriod: string; periodLimit: string };
  maturity: number;
  safety: { failure: "None"|"Paused"|"AssetNotActive"|"Matured"|"StaleNAV"|"SpotTwapDeviation"|"MarketNAVDeviation"|"ReserveBelowMinimum"|"Cooldown";
            checkedWithCooldown: boolean; lastRebalanceAt: number; cooldownSeconds: number } | null;
}
```
Replaces every numeric field of `solarAsset` and every hardcoded `Metric` on `/engine`, `/issuer`,
`/verifier`, `/`. Note the old fixture used percent (`24.6`) for ratio; API uses bps strings.

### 3.3 `GET /v1/assets/:assetId/candles`
```ts
{
  interval: 60|300|900|3600|14400|86400;
  source: "canonical_swap" | "mock";
  candles: Array<{
    timestamp: number;                     // bucket start, unix s — NOT "09:00"
    open: string; high: string; low: string; close: string;
    volumeAsset: string; volumeStable: string; tradeCount: number; finalized: boolean;
  }>;
}
```
Overlays (`nav`, `twap`, `floor`) are **not** in the candle rows (old fixture bundled them). The
UI fetches `/nav-history` and current `metrics` and draws overlays itself. `tradeCount: 0` rows are
forward-filled closes with `high == low == close` and zero volume; render them as flat, not as
candles. Y-domain must be computed from data, not `[0.78, 1.06]`.

### 3.4 `GET /v1/assets/:assetId/nav-history`
`Array<{ timestamp: number; nav: string; previousNav: string; txHash }>`

### 3.5 `GET /v1/assets/:assetId/positions`
```ts
{
  assetIsToken0: boolean; tickSpacing: number; currentTick: number | null;
  positions: Array<{
    kind: "ReserveFloor"|"Anchor"|"Discovery"|"Intermediary";
    configured: boolean;
    tickLower: number; tickUpper: number;
    priceLower: string; priceUpper: string;   // human mUSD per token, derived from ticks
    liquidity: string;                        // raw uint128 string; no amount conversion
    lastAction: { type: "Configured"|"LiquidityAdded"|"LiquidityRemoved"|"FeesCollected"|"Rebalanced"; timestamp: number; txHash } | null;
  }>;
}
```
Replaces `liquidityPositions[]` (`range: "0.700 - 0.880 mUSD"`, `primary: "7,200 mUSD"`) and the
literal band bounds in `engine-chart.tsx`. **There are no token-amount balances per position** in
the MVP; the UI must stop showing "7,200 mUSD / 9,800 SOLAR01" until a real pool exists.

### 3.6 `GET /v1/assets/:assetId/activity`
```ts
Array<{
  id: string;                       // `${txHash}:${logIndex}`
  timestamp: number; blockNumber: number; txHash: `0x${string}`; logIndex: number;
  type: "Purchase"|"RevenueDeposit"|"RevenueClaim"|"Redemption"|"NAVUpdate"|"StatusChange"
       |"Rebalance"|"LiquidityAdded"|"LiquidityRemoved"|"FeesCollected"|"Swap"
       |"ReserveDeposit"|"MarketFunded"|"MarketReturned";
  actor: `0x${string}`;
  summary: Record<string, string | number>;   // event-specific decoded fields, human units
}>
```
Replaces `rebalances[]` (`time: "15:08", shift: "+60 ticks"`). Rebalance `summary` =
`{ operation, spot, twap, nav, anchorLower, anchorUpper, tickShift }`.

### 3.7 `GET /v1/accounts/:address/assets/:assetId`
```ts
{
  tokenBalance: string; stableBalance: string;
  allowances: { offering: string; vault: string; revenueDistributor: string };
  yieldExcluded: boolean; yieldEligibleBalance: string;
  claimable: string;                       // "0.000000" is valid
  purchasedThisOffering: string; remainingWalletLimit: string;
  redemptionQuote: { mode: "Normal"; price: string; maxTokensThisPeriod: string } | null;
  marketValue: { value: string; provenance: "derived"|"mock" } | null;
  history: Array<ActivityItem>;             // filtered by actor
}
```
Replaces the hardcoded "Your position" card and `ActionDeck` balance hints. The UI should still
read `balanceOf`/`allowance`/`claimableRevenue` **directly from chain before transacting**; this
route is for display and history.

### 3.8 `GET /v1/assets/:assetId/revenue`
`{ totalDeposited, totalHolder, totalReserve, totalOperator, totalProtocol, totalClaimed, operatorAccrued, deposits: Array<{timestamp, txHash, gross, holder, reserve, operator, protocol}> }`

### 3.9 `GET /v1/assets/:assetId/redemptions`
`{ totalRedeemedTokens, totalStablecoinPaid, emergencySettlementPrice, currentPeriod: {...}, history: Array<{timestamp, txHash, holder, mode, tokenAmount, stablecoinAmount, nav, price}> }`

## 4. Frontend query layer expectations

- One typed client: `frontend/src/lib/api.ts` with `fetchJson<T>(path)` that parses the envelope,
  throws on `error`, and returns `{ data, meta }`.
- React Query keys namespaced `["api", route, assetId, params]`; `staleTime` ≤ backend
  `staleAfterSeconds`; invalidate `metrics`, `activity`, `accounts` after a confirmed tx.
- A `DataSourceBadge` component renders `meta.provenance` + `meta.stale` on every panel.
- Fixture mode: `data.ts` values are wrapped as `{ data, meta: { provenance: "mock", … } }` through
  the same client interface, so components never branch on "is this mock".

## 5. Transaction → indexer reconciliation

After `useWaitForTransactionReceipt` resolves, the UI polls `/v1/health` until
`meta.indexedBlock >= receipt.blockNumber` (max ~10 s on Anvil), then refetches. State machine:
`idle → validating → approval-required → awaiting-wallet → submitted → confirmed → indexed`
with `rejected / reverted / indexing-delayed` terminals.

## 6. Change log

| Date | Change | Migration |
| --- | --- | --- |
| 2026-08-27 | Initial target contract, derived from `docs/BACKEND_INDEXER.md` §12–13 and `frontend/src/lib/data.ts` | — |
| 2026-08-27 | **CHANGED** — `meta.indexedBlockHash` and `meta.asOf` are nullable before the first indexed block, and that state is always `stale: true`. | Frontend must accept `null` for both and treat it as "not indexed yet", not as an error. |
| 2026-08-27 | **CHANGED** — `GET /v1/health` ships and always returns the data envelope; HTTP `200` healthy/degraded, `503` unhealthy. Unknown route → `404` `BAD_REQUEST`; rate limited → `429` `BAD_REQUEST`. | The typed client must not treat a `503` health response as a transport failure; parse the body. |
| 2026-08-27 | **CHANGED** — `?chainId=` query parameter reserved on every asset route (D-030: one database, three chains). | Optional while one chain is configured; required once a second chain is indexed. |
| 2026-08-30 | **SHIPPED** — Milestone C. Every route in §2 except `/candles` is live: `/v1/assets`, `/v1/assets/:assetId`, `/metrics`, `/nav-history`, `/positions`, `/activity`, `/revenue`, `/redemptions`, `/v1/accounts/:address/assets/:assetId`. Each validates its payload against the schema in `backend/src/api/schemas/assets.ts` before sending. | The frontend can start migrating panels off fixtures. |
| 2026-08-30 | ~~**CHANGED** — `/candles` is not implemented~~ superseded below. |
| 2026-08-30 | **SHIPPED** — Milestone D. `/candles?interval=&from=&to=&limit=` is live with the §3.3 shape. `interval` must be one of 60/300/900/3600/14400/86400; anything else is `BAD_REQUEST`. | The chart can migrate, but must render the source badge — see the next two rows. |
| 2026-08-30 | **CHANGED** — `source` is `canonical_swap` or `mock`, never blended, and the envelope `provenance` matches it (`derived` or `mock`). On Anvil it is always `mock`: the demo pool emits no canonical `Swap` and its price does not move with trading. | The chart must show a Mock badge whenever `source === "mock"`, and must not present it as price discovery. |
| 2026-08-30 | **CHANGED** — with `ALLOW_MOCK_MARKET_DATA=false` (the default) `/candles` returns **503 `MOCK_DISABLED`**, not an empty array. | Render the error state. An empty array is indistinguishable from "never traded", which a chart draws as a flat line at zero. |
| 2026-08-30 | **CHANGED** — `metrics` gains a nullable `floor` block (D-025): `{ controller, tick, price, covered, canLevelUp, nextTick, cooldownSeconds, lastLevelUpAt }`. **`covered` is inside the object deliberately** — `isFloorCovered()` can go false with no event and no state change, because a NAV markdown can leave a valid level above the new NAV and D-025 pauses the ratchet rather than lowering the floor. | The published floor must never be rendered without its coverage flag beside it. A floor shown alone asserts something the contract does not. |
| 2026-08-30 | **CHANGED** — `/v1/assets/:assetId` gains `termsHash` (D-026), and `contracts` gains `floorController`. Both nullable. | `termsHash` is frozen at approval, so for an Active asset it identifies the parameters actually deployed. |
| 2026-08-30 | **CHANGED** — `change24h` on `/v1/assets` is now computed from the hourly close 24h ago. Still `null` — never `0` — when there is no pool, no candle that old, or no spot. | "Unchanged" and "unknown" are different; render a dash for null. |
| 2026-08-30 | **CHANGED** — activity `actor` is nullable. `NAVUpdated`, `AssetStatusChanged` and `Rebalanced` name no acting party; the actor is the transaction sender, which a log does not carry. | Render "—" for a null actor rather than assuming an address. |
| 2026-08-30 | **CHANGED** — `metrics.supply` gains `investor` (D-024 investor supply, the backing and redemption denominator). `supply.vesting` is now always `null` under D-031. `metrics` gains a nullable `reserveSchedule` block: `startBacking`, `targetBacking`, `targetBackingNow`, `currentBacking`, `startTime`, `maturity`, `graceSeconds`, `behindSchedule`, `inEnforcedShortfall`, `shortfallStartedAt` (D-023). | Three denominators now exist and are not interchangeable: `issued` (total), `investor` (backing), `eligibleCirculating` (revenue). `targetBackingNow` rises with time — do not cache it past `staleAfterSeconds`. |
| 2026-08-30 | **CHANGED** — `spot` and `twap` carry `mock` provenance whenever the pool is `MockUniswapV3Pool`, detected from its bytecode. On Anvil that is always. | Any panel showing spot or TWAP must render the Mock badge from the field's own provenance, not the envelope's. |
| 2026-08-30 | **CHANGED** — `/v1/assets?status=` takes the status **name** (`Active`), not the integer. `reserveRatioBps` is a decimal string, not a number. `metrics.redemption` gains `totalRedeemedTokens` and `totalStablecoinPaid`. | — |
| 2026-09-12 | **CHANGED** — `/metrics` gains `marketStatus` (`ready` | `warming_up` | `unavailable`) and two NAV fields, `nav.staleAfterSeconds` and `nav.expiresAt` (both nullable). `warming_up` means the pool exists but its TWAP window is not covered yet, so the price views revert with the pool's `OLD` error; `spot`, `twap` and `safety` are null and the condition clears itself within `twapWindow` seconds of the pool being initialised (30 minutes on the current deployments). `nav.expiresAt` is when the published NAV lapses; past it every keeper and liquidity path reverts until the verifier republishes. | **Two renderings to add.** `warming_up` is "market data warming up, ready in a few minutes", NOT an error or a dead market — the panel should recover on its own. And a NAV panel should warn as `nav.expiresAt` approaches rather than only once `nav.stale` flips, because by then trading is already blocked. `unavailable` keeps its current meaning. |
| 2026-09-12 | **CHANGED** — `?chainId=` is implemented on every asset route. Omitted, it means the chain the API process indexes (unchanged behaviour). Given, it must be a supported testnet (31337, 84532, 296) that has been indexed into the database *and* that the API has an RPC for; `meta.chainId` always names the chain actually served. Two refusals, never a silent fallback: `400 BAD_REQUEST` when the chain is unsupported or nothing has indexed it (the message lists the chains that are indexed), and the new `503 CHAIN_UNAVAILABLE` when it is indexed but this API has no endpoint for it. **New error code:** `CHAIN_UNAVAILABLE`. | A chain switcher can call any asset route with `?chainId=`. Handle `CHAIN_UNAVAILABLE` as "this deployment cannot serve that chain" rather than as a dead asset, and read `meta.chainId` back rather than assuming the request was honoured. |
| 2026-09-12 | **CLARIFIED** — `provenance` is per chain, because `poolIsCanonical` is. Base Sepolia's pool is a real Uniswap V3 pool, Anvil's is `MockUniswapV3Pool`, so the *same asset* legitimately returns `provenance: "derived"` on 84532 and `"mock"` on 31337 with identical `source`. Also per chain: token ordering. `assetIsToken0` is `true` on 84532 and `false` on 31337, so a tick means opposite prices on the two chains — never carry a tick, or an ordering, from one chain's response to another's. | A panel that caches a badge, or a tick-to-price conversion, across a chain switch shows a wrong price with a confident label. Re-read both from the response for the chain in view. |
| 2026-09-11 | **CHANGED** — `/candles` envelope `provenance` is `mock` whenever the pool is not a canonical Uniswap V3 pool, even when `source` is `"canonical_swap"`. The pool is identified from its bytecode with `poolIsCanonical`, the same check `spot`/`twap` use. The two fields answer different questions: `source` says where the candle's *events* came from (real `Swap` logs, or the synthetic adapter); `provenance` says whether the *price* is market data (D-019). On Anvil the demo pool's swaps are real events priced by a linear stand-in, so the response says `source: "canonical_swap"`, `provenance: "mock"`. | **Consumer-side migration (frontend, assigned to arcreserve-19):** derive the chart badge and the demo-feed disclaimer from `meta.provenance`, not from `source`. Today `price-chart.tsx` keys both on `source`, so the UI keeps showing **Derived** and hides the disclaimer until that change lands. |
| 2026-09-12 | **CHANGED** — D-035: the frontend base URL env var is renamed `NEXT_PUBLIC_API_URL` → `VITE_API_URL`. The envelope, routes, error codes, and provenance rules are unchanged. The dev server is pinned to port 3000, which is what the backend's default `CORS_ORIGIN` already allows. | Backend: no change required; keep `CORS_ORIGIN` defaulted to `http://localhost:3000`. Frontend: `lib/api.ts` and `lib/queries.ts` are ported verbatim, but only the landing page consumes them — the per-route consumer migrations listed above (including the `meta.provenance` chart badge) are outstanding again because the routes and charts were not ported. |
