# Boundary C — Backend → Frontend

The HTTP contract between the (not yet built) `backend/` service and the Next.js app. This is the
file both agents code against. The backend agent owns it; the frontend agent may propose fields.
Everything here is **target** until the backend milestone C ships; until then the frontend keeps
its fixtures, labeled `mock`.

Frontend base URL env var: `NEXT_PUBLIC_API_URL` (e.g. `http://127.0.0.1:4000`). Absent → the app
runs in fixture mode and every backend-sourced panel shows a `Mock` badge.

## 1. Envelope

Every `/v1` response:

```json
{
  "data": { ... } | [ ... ],
  "meta": {
    "chainId": 31337,
    "indexedBlock": 1234,
    "indexedBlockHash": "0x…",
    "asOf": 1786932000,
    "provenance": "onchain" | "derived" | "mock",
    "stale": false,
    "lagBlocks": 0
  }
}
```

Errors: HTTP 4xx/5xx with `{ "error": { "code": "ASSET_NOT_FOUND" | "INDEXER_BEHIND" | "MOCK_DISABLED" | "BAD_REQUEST" | "INTERNAL", "message": "…" } }`.

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
