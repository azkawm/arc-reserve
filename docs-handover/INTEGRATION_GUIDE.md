# ArcReserve integration guide: building the Stitch design against the real backend

**Audience:** the frontend integrator building the owner's Stitch design
(`design/stitch_arcreserve_rwa_launchpad_portal.zip`, 16 screens) on top of the live `/v1` API and the
deployed contracts.

**Owner of this file:** backend. It answers *where each number comes from*: endpoint, field path,
provenance, and what to do where nothing supplies it.

**Companion:** [`PRODUCT_KNOWLEDGE.md`](PRODUCT_KNOWLEDGE.md) (Contract Arch) answers *what each screen means
on chain*: contract, event, write signature, and whether a feature is LIVE, DERIVED or NOT IMPLEMENTED.
Where the two disagree about on-chain behaviour, PRODUCT_KNOWLEDGE and the Solidity win. Where they
disagree about an endpoint, this file and `backend/src/api/schemas/` win.

**Keys:** screens are keyed by their Stitch folder name, verbatim. Elements are keyed `<folder>#<element>`,
using the labels in PRODUCT_KNOWLEDGE.md §4 wherever it defines one; elements it does not label keep a
local name. PRODUCT_KNOWLEDGE abbreviates long folder names in keys: `step_1` … `step_5` =
`asset_owner_listing_flow_step_1_asset_classification` … `_step_5_verifier_review_vault_ignition`,
`document_filing` = `asset_owner_operational_reports_document_filing`, `telemetry_monitoring` =
`asset_owner_infrastructure_telemetry_monitoring`, `waterfall_distribution` =
`asset_owner_yield_share_waterfall_distribution`. Variant screens (`_desktop`, `_1`/`_2`) share their base
screen's keys.

Verified against the running services on 2026-09-13: Hedera `296` and Arc `5042002`, both served from one
base URL, backend commit `e7439a6`.

---

## Contents

1. [Rules an integrator will otherwise get wrong](#1-rules-an-integrator-will-otherwise-get-wrong)
2. [Chains, addresses and the one API URL](#2-chains-addresses-and-the-one-api-url)
3. [Health: what each field means for UI state](#3-health-what-each-field-means-for-ui-state)
4. [Endpoint reference](#4-endpoint-reference)
5. [Screen-by-screen mapping](#5-screen-by-screen-mapping)
6. [Screen-to-endpoint matrix](#6-screen-to-endpoint-matrix)
7. [Gaps: backend work vs NOT IMPLEMENTED](#7-gaps-backend-work-vs-not-implemented)
8. [Known gaps in the current frontend](#8-known-gaps-in-the-current-frontend)
9. [Design copy that must change before it ships](#9-design-copy-that-must-change-before-it-ships)

---

## 1. Rules an integrator will otherwise get wrong

Each rule below exists because the plausible alternative produces a wrong number that looks right.

### 1.1 Data integrity

1. **Never substitute a fixture for a failed or incomplete read.** A failed request renders an error
   state. A read the backend has marked incomplete or stale renders a stale or incomplete state. Every
   number in the Stitch HTML is a hardcoded example; none of them may survive into the build as a
   fallback. (D-019, Boundary C §1.)
2. **Render provenance from the response, per panel.** `meta.provenance` is `onchain`, `derived` or
   `mock`. Fields whose provenance differs from the envelope carry their own `{ value, provenance }`
   (`spot`, `twap`, the asset list's `spot`). Badge from the field when it has one, else from the
   envelope. Both live pools are canonical Uniswap V3, so market data reads `onchain`/`derived` there;
   Anvil reads `mock`.
3. **`null` is not `0`.** `change24h`, `spot`, `twap`, `floor`, `reserveSchedule`, `redemptionQuote` and
   friends are nullable on purpose. Render a dash or an explicit "unknown", never `0`.
4. **Amounts are decimal strings in human units.** Never parse them into JS `number` for arithmetic that
   ends in a transaction; use the `raw` base-unit string where one is given, or a decimal library. mUSD
   is 6 decimals, SOLAR01 is 18.

### 1.2 Market values

5. **`twap` is `null`, never `0`, and must not be drawn.** D-036 removed the TWAP. There is no
   time-weighted price anywhere: no TWAP line, no "weighted average" caption, no spot/TWAP gate row.
6. **`marketStatus` is keyed on spot alone.** `ready` means spot is live; `unavailable` means no pool or
   a failed price read. `warming_up` is a reserved value nothing returns today; keep it in your union
   type so the type still compiles, and render it as a self-recovering "warming up" state if it ever
   appears.
7. **`currentTick` comes from the pool's `slot0`**, via `/positions`. The manager's `meanTick` is always
   0; do not read it.
8. **`assetIsToken0` is per deployment.** Read it from `/positions` (or `assetIsToken0()` on chain) for
   the chain and asset in view. Never cache it across chains or redeploys, and never infer it from a
   fixture. The same human price is tick `t` under one ordering and `-t` under the other. Any tick↔price
   helper takes the ordering as a parameter. *Measured 2026-09-13:* `true` on both 296 and 5042002 (tick
   −275420 on each). The chains agreeing is exactly when an ordering bug hides; ordering moves with the
   deployer's nonce, so the next redeploy can flip either one. `frontend/src/lib/fixtures.ts:70` hardcodes
   `false`, which is wrong on both.
9. **NAV, spot, protected floor and redemption price are four different numbers** (CLAUDE.md product rule
   4). The design's redeem desk says it pays "at $0.380 floor"; it does not. Redemption pays
   `metrics.redemptionPrice.normal` (`min(NAV, backing)`), and the floor is a published *reference*
   (`metrics.floor.price`) that must always be shown with `metrics.floor.covered` beside it.

### 1.3 Safety and trades

10. **Safety failure codes 4, 5 and 6 stay in the mapping.** `SafetyFailure` is
    `0 None, 1 Paused, 2 AssetNotActive, 3 Matured, 4 StaleNAV, 5 SpotTwapDeviation, 6 MarketNAVDeviation,
    7 ReserveBelowMinimum, 8 Cooldown`. 4, 5 and 6 are reserved and never returned (D-036, D-039). Delete
    them from the array and 7 and 8 shift, so every keeper error message becomes wrong. `metrics.safety.failure`
    already serves the name.
11. **NAV staleness does not block trading.** Since D-039 NAV gates nothing in the market engine. A stale
    NAV banner may say "valuation is X days old, redemption quotes may be stale". It must not say "trading
    unavailable". Warn as `nav.expiresAt` approaches, not only once `nav.stale` flips.
12. **Swaps: approve the manager, display `amountSpent`, surface refunds.** The trade entry point is
    `AssetMarketManager.swapExactInput(tokenIn, amountIn, minAmountOut, deadline)`. The ERC-20 approval
    target is the **market manager**, not the pool. If the order exceeds available liquidity the swap stops
    early and refunds the unspent input. The `SwapExactInput` event, served on `/activity` as type
    `Swap`, carries `amountSpent`, `amountOut` and `amountRequested`. Show `amountSpent`, and on a partial
    fill (`amountSpent < amountRequested`) show the refund rather than hiding it. Buying SOLAR01 requires the
    wallet to be KYC-verified, so pre-check with `IdentityRegistry.isVerified(wallet)`. The `transferRestriction` form of that check is unverified for this path (Contract Arch). Compute `minAmountOut`
    from a live quote — `GET /v1/assets/:id/swap-quote?tokenIn=&amountIn=` (§5.2, B-6 closed 2026-09-13)
    returns `amountOut` from a real `eth_call` of the actual trade, no wallet connection needed for the quote
    itself; `0` is a demo shortcut, not a pattern. **Gas: always send an explicit 1,000,000 limit, on every
    chain, and never the wallet's estimate.** Below ~570k execution gas the whole swap reverts, because an
    out-of-gas in the post-trade flywheel escapes its try/catch. Receipts report only ~470k after refunds, so
    never size a limit from a past receipt (Contract Arch, measured). **Quote first, always:** call the quote
    endpoint before enabling the trade button. If it returns `503 QUOTE_UNAVAILABLE` (no quote wallet
    configured) or `400` with `details.revertedWith` (the trade would actually fail — insufficient liquidity,
    wrong token, a paused market), disable Swap with the reason rather than letting the wallet hit
    `InvalidSwapDirection` blind. Both pools were re-armed on 2026-09-13, but depth is thin: about 135 mUSD of
    buys and about 176 mUSD of sells per re-arm, with one flywheel turn per re-arm. Cap the input near the
    quote; a buy of about 250 mUSD or more blocks every later buy until a keeper re-arms — but trust the
    quote's own revert over this figure, since depth moves with every trade.

### 1.4 Charts and writes

13. **Candles return `503 MOCK_DISABLED` until a real trade exists.** That is an error state ("no trades
    yet"), not an empty chart. An empty array would draw a flat line at zero. Both live chains have one
    trade today, so each has exactly one hourly candle. Rows with `tradeCount: 0` are forward-filled; draw
    them flat.
14. **Wallet writes go direct to the contracts, never through the backend.** The backend holds no keys
    and never signs. Before transacting, read balances, allowances and `claimableRevenue` **from chain**;
    the API's account route is for display and history. After a confirmed receipt, poll `/v1/health` until
    the `indexers[]` entry **for that chain** has `blockNumber >= receipt.blockNumber`, then refetch.

---

## 2. Chains, addresses and the one API URL

### 2.1 One base URL, `?chainId=` on every call

One API base URL serves both live chains. Today that is the process on `:4000`, which indexes Hedera and
also serves Arc through Arc's own RPC. The Arc indexer on `:4001` is a worker, **not a second API to
call**.

- **Always send `?chainId=`.** Omitted, it silently means "the chain this API process indexes", which is
  Hedera. A panel on Arc's asset page that forgets the parameter shows Hedera's numbers with no error.
- **Read `meta.chainId` back** and treat a mismatch as an error. Never assume the request was honoured.
- **Two refusals, never a silent fallback:**
  - `400 BAD_REQUEST`: unsupported chain, or nothing indexed it. The message lists the indexed chains.
  - `503 CHAIN_UNAVAILABLE`: indexed, but this API has no RPC for it. Render "this deployment cannot serve
    that chain", not a dead asset.
- `31337` (Anvil) and `84532` (Base Sepolia, parked) exist in the shared database. Treat them as not
  offered in the product.

### 2.2 Live chains

| | Hedera testnet | Circle Arc testnet |
| --- | --- | --- |
| `chainId` | `296` | `5042002` |
| Gas token | HBAR | USDC, native, **18 decimals** (this is not mUSD) |
| Stablecoin in the product | MockUSD (`mUSD`), 6 decimals | MockUSD (`mUSD`), 6 decimals |
| Block time | ~2–3 s | ~0.5 s |
| Asset | SOLAR01 `0xda699bc7…59f4c4` | SOLAR01 `0xa506084b…76aa950` |

The design says **Base Sepolia** everywhere: the network chip, "Instant settlement on Base Sepolia" and
"Deploy Vault Contracts to Base Sepolia". Base Sepolia is parked. The chip must come from the connected
chain, and the copy must name Hedera or Arc.

### 2.3 Key addresses by `(chainId, address)`, never by address alone

The same deployer at the same nonce put **different contracts at the same address** on the two chains:

| Address | Hedera 296 | Arc 5042002 |
| --- | --- | --- |
| `0xECEbb2dA14751dd4EBD481CA8493ed6d6A6EA78C` | `AssetRegistry` | `AssetFactory` |
| `0x2243aA04e2Ca2d90fdd94F1A8A7028E00B6fB68c` | `DemoRegistrar` | `CountryAllowModule` |

A lookup keyed by address alone calls the wrong contract with no error. Hold a `chainId → addresses` map.

### 2.4 Chain readiness: Arc self-verification (fixed 2026-09-13)

**Fixed on 2026-09-13.** Before the fix, Contract Arch measured this with a fresh address:

| | Hedera 296 | Arc 5042002 |
| --- | --- | --- |
| `DemoRegistrar.isActive()` | true | true |
| `DemoRegistrar.canSelfRegister(wallet)` | true | **false** |
| `selfRegister()` (eth_call) | success | **reverts `UnsupportedChain(5042002)`** |

The old registrar's chain allowlist omitted Arc, so a fresh wallet could not become verified, and `buy` and
SOLAR01 swaps reverted. With the owner's approval, Contract Arch redeployed it:

- The new Arc registrar is `0xF6f77D0bE395df3d04B6E58a4a8fb0c34EC5286d` and holds `REGISTRY_AGENT_ROLE`.
- The old `0x86738829…` had the role revoked. Expect a `RoleGranted` and a `RoleRevoked` on Arc's identity
  registry.
- The backend session re-checked on chain after the redeploy: the new registrar has `isActive` true,
  `canSelfRegister(fresh)` true, and a `selfRegister` simulation that succeeds. The old one has `isActive`
  false and still reverts `UnsupportedChain`.

Arc can now carry the full judge journey.

- **Gate the "Verify me" button on `canSelfRegister(wallet)` on every chain.** A future regression then
  hides the button instead of offering a revert. Keep `IdentityRegistry.isVerified` for the badge.
- **Do not hardcode a `DemoRegistrar` address.** Arc's changed with this redeploy; read `demoRegistrar` from
  `contracts/deployments/<chainId>.json`.
Source it from `contracts/deployments/<chainId>.json`, or, for per-asset components, from
`/v1/assets/:assetId?chainId=` `contracts`. The current frontend holds one env-var address set, which
cannot express two chains; see §8.

---

## 3. Health: what each field means for UI state

`GET /v1/health` always returns the data envelope. Its HTTP status is `200` for healthy or degraded and
`503` for unhealthy; parse the body in both cases. `meta.provenance` is `derived`, because health is the
service's own state.

| Field | UI meaning |
| --- | --- |
| `status` | `healthy`, `degraded` or `unhealthy`, **for the chain this process indexes only**. `degraded` does not mean broken. It is also the normal state for a poll or two while a backfill or catch-up runs. `unhealthy` (DB or RPC down): show a global banner, since nothing truthful can be served. |
| `indexers[]` | One row per chain. Use the row whose `chainId` matches the page for lag and for transaction reconciliation (rule 14). A non-null `lastError` on that chain's row means its data may be behind. |
| `risks[]` | One row per `(chainId, assetId)`: `navExpiresAt`, `navStale`, `lastPriceVsNavBps`. **Key by both**; an assetId is not unique across chains. Warn before `navExpiresAt`. `lastPriceVsNavBps` comes from the last indexed hourly close; never label it live spot. |
| `riskCoverage.notComputed[]` | Chains this process cannot read, with the reason. A chain listed here is **unknown, never safe**: its assets are just as exposed. Do not render "no risks" for it. |
| `pendingBackfills[]` | `{ chainId, count }`: discovered contracts whose earlier logs are not fetched yet. While a chain is listed, its compliance, identity and floor data is knowingly incomplete. Show a "syncing" state on those panels and do not present that data as complete. One poll is normal; if it persists, raise it. |
| `rollbacks[]` | Per chain, a durable record of reorg rollbacks (`count`, `last`). Informational, and never an error state. On Hedera, which has no reorgs, any entry is a defect worth raising. |
| `anomalies.byChain[]` | Rows the projector flagged instead of overwriting. `indexedChain` drives `status`; `byChain` shows where a backlog is. |

Per-response freshness lives on every asset response, not only on health: `meta.stale`, `meta.lagBlocks`,
`meta.asOf`. `asOf: null` means "nothing indexed yet"; render not-indexed, not an error.

---

## 4. Endpoint reference

Every route takes `?chainId=`. Shapes are the Zod schemas in `backend/src/api/schemas/assets.ts`; every
response is validated against them before it is sent.

| Route | Query | Envelope provenance | Gives |
| --- | --- | --- | --- |
| `GET /v1/assets` | `status` (name, e.g. `Active`, `Pending`), `limit` ≤ 200, `cursor` | `onchain` | List: identity, `status`, `issuer`, `spot{value,provenance}`, `floor`, `reserve`, `change24h`, `contracts` |
| `GET /v1/assets/:assetId` | — | `onchain` | Detail: `metadataURI`, `metadataHash`, `termsHash`, `maturity`, `submittedAt`, `contracts` incl. `pool`, `floorController` |
| `GET /v1/assets/:assetId/metrics` | — | `onchain` (read at the indexed block) | `nav{value,raw,timestamp,stale,staleAfterSeconds,expiresAt}`, `marketStatus`, `spot`, `twap` (null), `floorReference`, `redemptionPrice{normal,maturity,emergency}`, `reserve{…five categories…, totalAccounted, vaultBalance, reserveRatioBps, minimumReserveRatioBps, minimumRequiredReserve, isSolvent, availableRedemptionLiquidity}`, `reserveSchedule{startBacking,targetBacking,targetBackingNow,currentBacking,startTime,maturity,graceSeconds,behindSchedule,inEnforcedShortfall,shortfallStartedAt}`, `supply{maximum,issued,excluded,investor,eligibleCirculating,headroom}`, `offering{price,raised,cap,sold,inventory,walletLimit,minimumPurchase,startsAt,endsAt,open}`, `redemption{…period…, totalRedeemedTokens,totalStablecoinPaid}`, `floor{controller,tick,price,covered,canLevelUp,nextTick,cooldownSeconds,lastLevelUpAt}`, `maturity`, `safety{failure,checkedWithCooldown,lastRebalanceAt,cooldownSeconds}` |
| `GET /v1/assets/:assetId/candles` | `interval` ∈ `60,300,900,3600,14400,86400` (**seconds**; `1h` is a 400), `from`, `to`, `limit` | `derived` (canonical pool) / `mock` | `interval`, `source`, `candles[]{timestamp,open,high,low,close,volumeAsset,volumeStable,tradeCount,finalized}`; **503 `MOCK_DISABLED`** before the first trade |
| `GET /v1/assets/:assetId/nav-history` | `from`, `to`, `limit` | `onchain` | `[]{timestamp, nav, previousNav, txHash}` |
| `GET /v1/assets/:assetId/positions` | — | `onchain` | `assetIsToken0`, `tickSpacing`, `currentTick` (slot0), `positions[]{kind,configured,tickLower,tickUpper,priceLower,priceUpper,liquidity (raw),lastAction}`. **No token amounts per position.** |
| `GET /v1/assets/:assetId/activity` | `type`, `limit` ≤ 200 | `onchain` | `[]{id,timestamp,blockNumber,txHash,logIndex,type,actor|null,summary}`; see §4.1 |
| `GET /v1/assets/:assetId/revenue` | — | `onchain` | `totalDeposited,totalHolder,totalReserve,totalOperator,totalProtocol,totalClaimed,operatorAccrued`, `deposits[]{timestamp,txHash,periodId,reportHash,behindSchedule,gross,holder,reserve,operator,protocol}` |
| `GET /v1/assets/:assetId/redemptions` | — | `onchain` | Totals, `emergencySettlementPrice`, `currentPeriod{startedAt,duration,redeemed,limit,remaining}` (**tokens**), `history[]` |
| `GET /v1/accounts/:address/assets/:assetId` | — | `onchain` | `tokenBalance`, `yieldExcluded`, `issuerAllocation`, `yieldEligibleBalance`, `claimable`, `frozen`, `frozenTokens`, `complianceExempt`, `verified`, `identity{country,investorClass,claimExpiresAt,registered}`, `purchasedThisOffering`, `remainingWalletLimit`, `redemptionQuote{mode,price,maxTokensThisPeriod}`, `history[]` |
| `GET /v1/assets/:assetId/swap-quote` | `tokenIn` (address: this asset's token or the chain's stablecoin), `amountIn` (decimal string, `tokenIn`'s own decimals) | `onchain` (live `eth_call`, never cached) | `{tokenIn,tokenOut,amountIn,spent,amountOut,partialFill}`. **`spent` may be LESS than `amountIn`** (D-037's partial-fill refund) — compute price as `amountOut/spent`, never `amountOut/amountIn`. Detecting this costs an extra call every time and up to ~24 more on the (rare) saturated path: **~1-2s normally, up to ~12s when `partialFill` is true** — show a distinct loading state for a large order. **503 `QUOTE_UNAVAILABLE`** if no quote wallet is configured; **400** with `details.revertedWith` if the real trade would also fail there (B-6, closed 2026-09-13) |
| `GET /v1/health` | — | `derived` | §3 |

Errors are `{ error: { code, message } }`, with codes `ASSET_NOT_FOUND`, `INDEXER_BEHIND`,
`MOCK_DISABLED`, `BAD_REQUEST`, `CHAIN_UNAVAILABLE`, `QUOTE_UNAVAILABLE` and `INTERNAL`. A
rate-limited request is `429`.

> **Boundary doc drift, on purpose flagged here:** `BACKEND_TO_FRONTEND.md` §3.7 still lists
> `stableBalance`, `allowances` and `marketValue` on the account route. **The API does not serve them**
> (see the schema). Read mUSD balance and allowances from chain; compute market value client-side and
> label it `derived`.

### 4.1 Activity types

`type` values: `Purchase`, `RevenueDeposit`, `RevenueClaim`, `Redemption`, `NAVUpdate`, `StatusChange`,
`Rebalance`, `LiquidityAdded`, `LiquidityRemoved`, `PositionConfigured`, `FeesCollected`, `Swap`,
`SurplusCredited`, `FlywheelSkipped`, `FloorLevelUpSkipped`, `ReserveDeposit`, `MarketFunded`,
`MarketReturned`, `IssuerWithdrawal`, `ProtocolFeesWithdrawn`, `ReserveYield`,
`ResidualReserveReleased`, `ReserveShortfall`, `ReserveShortfallCleared`, `FloorLevelUp`,
`FloorCooldownSet`, `FloorControllerSet`, `TermsApproved`, `Transfer`, `IdentityRegistered`,
`IdentityUpdated`, `IdentityRemoved`.

Things to handle:

- **`summary` differs per event.** Stable amounts are 6-decimal human strings, token amounts are
  18-decimal human strings, and `raw` fields (swap and position amounts) are base-unit integers. A trader
  `Swap` summary carries `trader`, `tokenIn`, `amountSpent`, `amountRequested` and `amountOut` (measured
  on both chains). All amounts are raw. There is no `tokenOut` field: the output token is the other side of
  the pair. Pick the decimals by comparing `tokenIn` with the asset's `contracts.token` for that chain, and
  do not assume a direction. A keeper `Swap` (from `SwapExecuted`) has `amountIn` / `amountOut` instead and
  no `trader`.
- **`actor` is `null`** for `NAVUpdate`, `StatusChange` and `Rebalance`. Render "—".
- **`FlywheelSkipped` / `FloorLevelUpSkipped`** carry a decoded `reason` (`NO_CONTROLLER`, `NOT_ELIGIBLE`,
  …). They are informational and never errors. `FlywheelSkipped(NO_DISCOVERY_LIQUIDITY)` is the normal
  result once discovery has been harvested.
- **`?type=` is a filter over a bounded recent window, not a query over all history.** The route fetches
  about `4 × limit` recent logs and filters them. A rare type, such as `FloorLevelUp` among many swaps,
  can come back short or empty even though it exists. Do not build a full floor history from it; see gap
  B-3.

---

## 5. Screen-by-screen mapping

Per element, the table gives the source, the provenance to badge, and a verdict:

- **API**: served, as named.
- **DERIVE**: computed client-side from served fields. Label it `derived` and show the formula in a
  tooltip.
- **CHAIN**: read directly with viem at transaction time (not a backend concern).
- **GAP-B**: the chain has it, but no endpoint serves it yet (backend work; §7.1).
- **NOT IMPL**: nothing on chain or in the backend. Remove it, or relabel it as an illustrative preview
  per product rule 10. Contract Arch's PRODUCT_KNOWLEDGE decides the product status; see §7.2.

`M` = `/v1/assets/:id/metrics`, `A` = `/v1/accounts/:wallet/assets/:id`, `R` = `/revenue`, `L` = the
`/v1/assets` list item. Every path takes `?chainId=`.

**How these verdicts map to the handover status vocabulary** ([`README.md`](README.md)). The verdicts
here say *where the data comes from*; the status says *what it is*:

| Verdict here | Status | Note |
| --- | --- | --- |
| API, envelope/field provenance `onchain` | **LIVE** | A contract read or event, served at the indexed block |
| API, provenance `derived` (candles, health) | **DERIVED** | Computed by the backend |
| DERIVE (client-side) | **DERIVED** | Computed by the frontend. Say so in the tooltip, because no endpoint owns it |
| CHAIN | **LIVE** | Read or written directly by the wallet |
| GAP-B | **LIVE** on chain | No endpoint yet; use the §7.1 fallback |
| NOT IMPL | **NOT IMPLEMENTED** | Remove, or label as a preview |

The authoritative per-element status is PRODUCT_KNOWLEDGE.md's.

### 5.1 `launchpad_offerings` and `launchpad_offerings_desktop`

| Element | Source | Verdict |
| --- | --- | --- |
| `#network-chip` | Connected wallet chain, then the §2.2 name | CHAIN (not "Base Sepolia") |
| `#kyc-badge` | `A.verified` (display); `IdentityRegistry.isVerified` before any write | API / CHAIN |
| `#filter-pills`, `#search`, `#sort` | `L.category`, `L.symbol`, `L.name`, client-side. **Call `/v1/assets` once per chain** (296 and 5042002) and merge, keyed by `(chainId, assetId)` | DERIVE |
| `#featured-name`, `#symbol`, `#category` | `L.name`, `L.symbol`, `L.category` | API |
| `#location`, `#hero-image`, `#installed-capacity`, `#offtaker`, `#registry-id` | Asset metadata document behind `/v1/assets/:id` `metadataURI` (off-chain JSON, integrity via `metadataHash`). The backend does not fetch or parse it | GAP-B (no metadata resolver) or client fetch of the URI |
| `#stage-badge` "Primary Stage" | `L.status` (`Active`) + `M.offering.open` | API |
| `#subscribed-progress` | `M.offering.raised / M.offering.cap` | DERIVE |
| `#remaining` (raised, cap, bar) | `M.offering.raised`, `.cap`, `cap − raised` | API / DERIVE |
| `#issue-price` | `M.offering.price` | API |
| `#min-ticket` | `M.offering.minimumPurchase`. The connected wallet's real limit is `A.remainingWalletLimit`, and `PrimaryOffering.remainingAllowance(wallet)` at transaction time folds in the D-028 class caps | API / CHAIN |
| `#closes-in` | `M.offering.endsAt − now` | DERIVE |
| `#sinking-floor` "0.38 mUSD" | `M.floor.price` **with `M.floor.covered`**. Not backing, not redemption price | API |
| `#ratchet-active` | `M.floor.canLevelUp`, `M.floor.lastLevelUpAt` | API |
| `#reserve-solvency` "100% On-Schedule" | `M.reserveSchedule.currentBacking / targetBackingNow`, and `behindSchedule` / `inEnforcedShortfall` for the label | DERIVE / API |
| `#grace-days` | `M.reserveSchedule.shortfallStartedAt` and `graceSeconds` (`null` shortfall → 0 days) | DERIVE |
| `#verified-nav` | `M.nav.value`, with `M.nav.stale` and `M.nav.expiresAt` | API |
| `#est-cash-yield` "14.8% APR", `#target-apr` | No forward yield exists. A trailing *realized* figure can be derived from `R.deposits[].holder` over a window ÷ market value, labelled "trailing, realized, not a forecast" | NOT IMPL as shown (a projection); DERIVE only as trailing realized |
| `#rev-share` "60%" | Live split is `activeSplit()`, not served. `R.deposits[-1].behindSchedule` says which split the last deposit used (60/25/10/5 vs 40/45/10/5) | GAP-B (B-1) |
| Desktop `#protocol-tvl` | Sum of `M.reserve.vaultBalance` over every asset on both chains (N metrics calls) | DERIVE today, GAP-B (B-5) for an aggregate |
| `#historical-default` (with TVL delta, track record) | — | NOT IMPL |
| `#avg-apr` | As `#est-cash-yield` | NOT IMPL as shown |
| `#iot-telemetry` (generation, accrued cash flow, block) | — (no telemetry on chain). "Accrued this month" can only be `R.deposits` for the current `periodId` | NOT IMPL (telemetry) / DERIVE (deposits) |
| `#pipeline-cards` | `/v1/assets?status=Pending` and `?status=Approved`. Name, category, issuer and status only | API |
| `#pipeline-cards` target raise, APR, term, verification stage | Not on chain before deployment. The terms are bound only as `termsHash` at approval | NOT IMPL |
| `#subscribe-cta` | Navigation. The write is `PrimaryOffering.buy` after `approve(offering)` | CHAIN |
| `#request-whitelist`, `#pre-register`, `#data-room`, `#bookmark`, `#diligence-pack` | — | NOT IMPL (no off-chain store; §7.2) |
| `#redeem-copy` "redeemable on demand at min(NAV, backing)" | Accurate formula, but "on demand" is wrong: redemption is period-limited and reserve-limited | copy fix (§9) |

### 5.2 `asset_detail_secondary_trading_solar01_1` and `_2`

The two variants share one data model. `_2` adds `#volume-liquidity` and a chart mode toggle.

**Header, metrics and chart**

| Element | Source | Verdict |
| --- | --- | --- |
| `#contract-address` | `/v1/assets/:id` `contracts.token`, **with the chain named** | API |
| `#status-badge` | `detail.status` (the enum name). "Active Secondary & Sinking Escrow" is not a status | API |
| `#institutional-verification` ("JLL & CertiK Verified", CertiK score), `#credit-rating` (and default history) | — | NOT IMPL: remove |
| `#scada-status`, `#epoch-sync` | — (no telemetry). "Data freshness" is `meta.asOf` and `meta.stale` | NOT IMPL / API |
| `#spot-price` | `M.spot.value` with `M.spot.provenance`, gated on `M.marketStatus === "ready"` | API |
| `#spot-change` | `L.change24h` (null → dash) | API |
| `#spot-caption` "Secondary AMM weighted average" | Wrong: this is raw spot, not an average | copy fix |
| `#parity` / `#par` "$1.000" | Par is the reserve schedule's end target: `M.reserveSchedule.targetBacking`. Not the offering price, even though both are 1.00 in the demo | API |
| `#nav` (value and caption) | `M.nav.value`, `M.nav.timestamp`, `M.nav.expiresAt`. There is no "quarterly" cadence and no JLL | API / copy fix |
| `#protected-floor` | `M.floor.price` **plus `M.floor.covered`** | API |
| `#ratchet-level` "Lvl 8" | No level index on chain. Count `FloorLevelUp` activity, or show `M.floor.tick` | DERIVE (with B-3 caveat) |
| `#apr` | As §5.1 `#est-cash-yield` | NOT IMPL as shown |
| `#volume-liquidity` (24 h volume, `_2`) | Sum of `volumeStable` over the last 24 hourly candles (`interval=3600&limit=24`) | DERIVE |
| `#volume-liquidity` ("$310k" liquidity, `_2`) | Positions carry no token amounts. The honest figure is `M.reserve.marketMakingAllocation` (vault market allocation), labelled as such. It is not pool TVL | API (relabel) |
| `#corridor-chart` spot series | `/candles?interval=…` `close`. 503 → "no trades yet". The `1D/1W/1M/1Y/ALL` pills map to `interval` + `from`: e.g. 1D → 900 or 3600, 1W → 3600 or 14400, 1M and 1Y → 86400 | API |
| `#corridor-chart` floor step series | `FloorLevelUp` activity `summary.floorPrice` over time. Partial for long histories (B-3). Current value `M.floor.price` | DERIVE / GAP-B (B-3) |
| `#corridor-chart` NAV line | `/nav-history` (step series), not a flat dashed line | API |
| `#corridor-chart` parity baseline | `M.reserveSchedule.targetBacking` | API |
| `#corridor-chart` x-axis "Epoch 04…" | Timestamps; there are no epochs on chain | copy fix |
| `#genesis-parity-base` "$0.300" | `M.reserveSchedule.startBacking` (backing), which is **not** a floor | API (relabel) |
| `#ratchet-rate` "+$0.010 / 30d" | Not a rate. The floor moves one tick spacing per `levelUp()` (~0.6%), gated by `M.floor.cooldownSeconds` and `canLevelUp`. `M.floor.nextTick` is the next level | API (relabel) |
| `#corridor-chart` delta-spread toggle (`_2`) | `spot − floor.price`, client-side | DERIVE |

**Workspace tabs, trade desk, position and verification**

| Element | Source | Verdict |
| --- | --- | --- |
| `#tab-dividends` | Rename to "Revenue distributions"; "dividends" is a forbidden claim | copy fix |
| `#claim-yield` amount | `A.claimable` (display); `RevenueDistributor.claimableRevenue(wallet)` before claiming. `"0.000000"` is valid | API / CHAIN |
| `#claim-yield` action | `RevenueDistributor.claimRevenue()` | CHAIN |
| `#settlement-ledger` rows | `R.deposits[]`: `periodId` → Epoch, `gross` → Distribution total, `txHash` → Proof, `reportHash` → report link | API |
| `#ledger-kwh-invoice` | — | NOT IMPL |
| `#settlement-ledger` payout per 1k tokens | `holder / eligibleCirculating × 1000`, but eligible supply **at deposit time** is not served. Current supply gives a wrong historical figure | GAP-B (B-7) |
| `#reserve-vault-funded` "104.2% funded", vault, required | `M.reserve.redemptionReserve` vs `M.reserve.minimumRequiredReserve` (ratio: `M.reserve.reserveRatioBps`), or backing vs schedule via `M.reserveSchedule`. Pick one and label it | API |
| `#tab-reserve-waterfall` | `M.reserve`: the five categories + `totalAccounted`, `vaultBalance`, `isSolvent` | API |
| `#tab-legal-ipfs` | `detail.metadataURI`, `metadataHash`, `termsHash` | API |
| `#swap-panel` balances | mUSD / SOLAR01 `balanceOf(wallet)` | CHAIN |
| `#swap-panel` quote and you-receive; `#swap-price-impact` | `GET /v1/assets/:id/swap-quote?tokenIn=&amountIn=` → `amountOut` AND `spent` (B-6, closed 2026-09-13). No wallet connection or signature needed for the quote itself. When `partialFill` is true, `spent < amountIn` — show the refund ("only X of your Y will be spent") rather than implying the full amount trades. Impact = `amountOut/spent` vs `M.spot`, never `amountOut/amountIn`. Re-fetch on every input change and again right before signing — pool state moves between the two, and a saturated quote can take up to ~12s, so debounce input changes rather than firing on every keystroke | API |
| `#swap-panel` slippage | Client setting → `minAmountOut = quote × (1 − tolerance)` | DERIVE |
| `#swap-protocol-fee` "0.05%" | Pool fee tier is `pool.fee()`, not served. The live pools are 0.30% (Contract Arch), not the design's 0.05%; read it, do not hardcode | CHAIN / GAP-B (B-8) |
| `#swap-panel` approve + execute | `approve(marketManager, amountIn)`, then `swapExactInput(tokenIn, amountIn, minAmountOut, deadline)`. Show `amountSpent` and any refund afterwards (rule 12) | CHAIN |
| `#swap-route` / `#swap-price-impact` copy ("Instant settlement", "0 Price Impact") | — | copy fix |
| `#instant-redeem` price | `A.redemptionQuote.price` (= `M.redemptionPrice.normal`), **not** the floor | API |
| `#daily-allowance` "$25,000 mUSD" | `/redemptions` `currentPeriod.remaining`, which is **in tokens, not mUSD**. Also cap by `A.redemptionQuote.maxTokensThisPeriod` and `M.reserve.availableRedemptionLiquidity` | API (unit fix) |
| `#instant-redeem` you-receive | `tokens × redemptionQuote.price`, client-side; check on chain via `RedemptionController.redemptionPrice(0)` | DERIVE / CHAIN |
| `#instant-redeem` execute | `RedemptionController.redeem(tokenAmount, minimumStablecoinOut, 0)`. **No token approval step:** the controller burns under its role. Compute `minimumStablecoinOut` from the quote; `0` is unprotected | CHAIN |
| `#instant-redeem` disabled states | `A.issuerAllocation` (cannot redeem), `A.frozen`, `M.safety`, status ≠ `Active` for mode 0 | API |
| `#position-balance` | `A.tokenBalance`; spendable = balance − `A.frozenTokens` | API |
| `#position-market-value` | `tokenBalance × M.spot.value`, labelled with spot's provenance | DERIVE |
| `#position-pnl` (cost basis, P&L, return) | From `A.history` `Purchase` (`stablecoinAmount`, `tokenAmount`) and `Swap` rows. Partial if history exceeds the window | DERIVE |
| `#position-accrued` | `A.claimable` (one number; the design shows two conflicting figures) | API |
| `#auto-staking` (and "Class A Senior") | — | NOT IMPL: remove |
| `#protected-exit` | `tokenBalance × redemptionQuote.price`, labelled "at today's quote, subject to period limit and reserve" | DERIVE |
| `#institutional-verification` "Chainlink online" | No Chainlink. Freshness = `meta.asOf` / `meta.stale` | NOT IMPL / API |

### 5.3 Listing flow: `asset_owner_listing_flow`, `_desktop`, `_step_1` … `_step_5`

The whole wizard is a **multi-step draft that does not exist anywhere**. No backend stores drafts,
documents, eligibility checks or verifier queues, and the backend holds no keys. What exists on chain is
a short, specific sequence. Contract Arch owns the signatures in PRODUCT_KNOWLEDGE:

1. **Issuer submits.** `AssetRegistry.submitAsset(name, category, metadataURI, metadataHash, maturity)`
   creates a `Pending` asset.
2. **Verifier approves.** `AssetRegistry.approveAsset(assetId, initialNAV, termsHash)` binds a hash of the
   deployment parameters (D-026).
3. **Issuer deploys in two transactions from the same wallet** (D-033):
   `AssetFactory.beginAssetSystem(params)`, then `completeAssetSystem(assetId, params)`, or
   `abandonAssetSystem(assetId)` to back out.

| Element | Source | Verdict |
| --- | --- | --- |
| Stepper / pipeline state, "auto-saving draft", session ID | — | NOT IMPL (client-local draft at most; no server store) |
| `step_1#asset-class` cards, risk tier, LTV, recommended facility, target APR, DSCR, eligibility 4/4 (`step_1#underwriting-eligibility`), production history (`step_1#production-history`), off-taker credit (`step_1#offtaker-credit`) | — | NOT IMPL (only `category`, a free string, reaches the chain) |
| `step_1#registry-identifier` "name / symbol" | Name → `submitAsset.name`. The symbol is a deployment parameter | CHAIN |
| `step_1#jurisdiction`, `step_1#inception-term`, `step_1#telemetry-framework` | Off-chain metadata JSON (`metadataURI`) | NOT IMPL (no metadata authoring or pinning service) |
| `step_2#target-sizing` (and the raise input on `asset_owner_listing_flow`) | Deployment parameter (fundraising cap, inventory, price). Not readable until deployed; afterwards `M.offering.cap`, `.inventory`, `.price` | CHAIN (pre-deploy) / API (post) |
| `asset_owner_listing_flow#settlement-split`, `step_2#split-invariant` 65/30/5 | Fixed by `PrimaryOffering` (D-023), not an input. After deployment, verify from `Purchase` activity `issuerShare/reserveShare/marketShare` | DERIVE (preview only) |
| `asset_owner_listing_flow#revenue-covenant` 60/25/10/5 (and `step_3#split-toggle`, `step_3#tilt-trigger`) | Fixed by `RevenueDistributor`; 40/45/10/5 while behind schedule. Not an input | GAP-B (B-1) for the live split |
| `asset_owner_listing_flow#backing-trajectory`, `step_3#amortization-points` $0.30 → $1.00 / 36 m | Post-deploy: `M.reserveSchedule.startBacking`, `targetBacking`, `startTime`, `maturity` (a linear line between them). Pre-deploy: parameters | API (post) |
| `step_2#ticket-limits` | Post-deploy: `M.offering.minimumPurchase`, `walletLimit`; class caps are `PrimaryOffering.classLimits(class)` | API / CHAIN |
| `step_2#eligibility-classes` QIB / Retail / Reg S | Investor classes (D-028) exist as retail, accredited and institutional caps. "Reg S" and "QIB" do not exist | CHAIN (class caps) / copy fix |
| `step_2#amm-range` "0.985–1.015" | Post-deploy: `/positions` bands. Pre-deploy: parameter | API (post) |
| `step_3#returns-simulator`, `step_3#default-ladder` steps 3–5 (issuer key lock, trustee lien) | — | NOT IMPL. Steps 1–2 map to `reserveSchedule.behindSchedule` / `inEnforcedShortfall` |
| `step_3#oracle-pipeline` Chainlink / Schneider | — | NOT IMPL |
| `step_4#spv-entity` (incl. trustee), `step_4#lien-registry`, `step_4#signatories`, `step_4#enforcement-layers` | — | NOT IMPL (no legal entity; hackathon scope) |
| `step_4#ipfs-deeds` (and `asset_owner_listing_flow#ipfs-documents`) | — (no document store or pinning). The only on-chain anchors are `metadataHash` and `termsHash` | NOT IMPL / API (hashes) |
| `step_4#term-sheet-hash`, `step_5#merkle-root` | The real value is `detail.termsHash` (bytes32, 64 hex; the mockup's 62-hex value is invalid). It exists only after approval. It is `keccak256(abi.encode(DeploymentParams))`, **not** a Merkle root of documents, so the design's framing is wrong, not merely unimplemented; deployment with different parameters reverts `TermsMismatch` | API |
| `step_5#check-compliance`, `step_5#check-vault-isolation`, `step_5#check-ratchet` | — | NOT IMPL. The one real pre-flight is `status === "Approved"` plus `AssetFactory.isPending(assetId)` for a half-built system |
| `step_5#term-summary` | Post-deploy: `detail` + `M`. Pre-deploy: the parameters the verifier is about to hash | API (post) |
| `step_5#check-nav` (initial NAV) | Post-approval: `M.nav.value`, `/nav-history[0]` | API |
| `step_5#maker-checker`, verifier panel, SLA (`asset_owner_listing_flow#review-sla`) | — | NOT IMPL (one verifier role; no queue) |
| `step_5#gas-sponsored`, `step_5#factory-address`, execution estimate | Wallet `estimateGas`. "100% sponsored gas", paymaster and relayer do not exist | CHAIN / NOT IMPL |
| `step_5#ignition-button` | Two wallet transactions (above). Between them the asset reads `Approved` with a vault that rejects deposits (`SystemNotActive`): render "deployment in progress" | CHAIN |
| `step_5#ignition-button` success (vault address, tx) | Receipt, then `/v1/assets/:id` `contracts` once indexed. Poll health per chain; `pendingBackfills` may list the chain briefly while new components backfill (§3) | CHAIN / API |
| `asset_owner_listing_flow#submit-for-review`; `step_5#submit-final-cosign` | There is no off-chain queue. Submission *is* `submitAsset`; the verifier sees it via `/v1/assets?status=Pending` | CHAIN / API |

### 5.4 `asset_owner_operational_reports_document_filing`

| Element | Source | Verdict |
| --- | --- | --- |
| `#ledger-synced` block | `/v1/health` `indexers[]` row for the chain: `blockNumber` | API |
| `document_filing#deadlines` filing status "Compliant" | `RevenueDistributor.isReportingOverdue()`, not served | GAP-B (B-1) |
| `document_filing#deadlines` next audit and schedule | `reportingDueAt()` for the revenue report is not served. Site inspections and franchise renewals are NOT IMPL | GAP-B (B-1) / NOT IMPL |
| `document_filing#filing-gateway`, `document_filing#filing-ledger` (count, rows, upload, OCR/encrypt, CIDs); the on-chain anchor is `document_filing#revenue-report-anchor` | — (no document store). The one on-chain filing anchor is `R.deposits[].reportHash` with its `periodId` and `txHash` | NOT IMPL / API |
| `#oracle-fidelity`, `#scada-consistency` | — | NOT IMPL |
| `#collateral-lien-registry`, `#spv-trustee-key` | — | NOT IMPL |
| `document_filing#verifier-queue` (pending task, comments) | — | NOT IMPL |
| `document_filing#master-root` | `detail.metadataHash` (and `termsHash`) | API |
| `document_filing#proof-of-reserve` | — (no PDF generation). The real reserve figures are `M.reserve`; an export can be built client-side from them, labelled with `meta.indexedBlock` | DERIVE |
| `#export-ledger` | Client-side CSV from `R.deposits` | DERIVE |

### 5.5 `asset_owner_infrastructure_telemetry_monitoring`

| Element | Source | Verdict |
| --- | --- | --- |
| `telemetry_monitoring#managed-asset-value` | `M.nav.value × M.supply.investor` | DERIVE |
| `#yoy-benchmark` | — | NOT IMPL |
| `telemetry_monitoring#energy-telemetry`, `telemetry_monitoring#health-hub` (gross energy, SCADA chart, inverter, grid, temperature, oracle signature, failover) | — | NOT IMPL (no telemetry exists on chain or in the backend) |
| `telemetry_monitoring#revenue-accrued` | Sum of `R.deposits[]` for the current `periodId` | DERIVE |
| `telemetry_monitoring#sinking-solvency` | `M.reserveSchedule.currentBacking` vs `targetBackingNow`; absolute `M.reserve.redemptionReserve` vs `minimumRequiredReserve` | API / DERIVE |
| `telemetry_monitoring#fleet-registry` | `/v1/assets` per chain, filtered by `issuer === wallet` client-side (no `?issuer=`) | DERIVE / GAP-B (B-2) |
| `#facility-card` status, solvency, term | `L.status`, `M.reserve.reserveRatioBps`, `detail.maturity` | API |
| `#facility-card` APR, PPA obligor, "Ringfenced" | — | NOT IMPL |
| `telemetry_monitoring#delinquency-tracker` | `isReportingOverdue()`, not served | GAP-B (B-1) |
| `telemetry_monitoring#covenant-ratchet` | `M.floor` (see §5.2 `#ratchet-rate`) | API |
| `#covenant` bankruptcy remoteness | — | NOT IMPL |
| `telemetry_monitoring#settlement-desk` countdown | `reportingDueAt()`, not served | GAP-B (B-1) |
| `telemetry_monitoring#settlement-desk` split preview | Needs the live split (`activeSplit()`, B-1). Until then, derive from `M.reserveSchedule.behindSchedule`, labelled as such | DERIVE / GAP-B |
| `#activity-log` | `/activity` (per chain). Telemetry events are NOT IMPL; `NAVUpdate` and `RevenueDeposit` are real | API |
| `telemetry_monitoring#execute-distribution` | `approve(revenueDistributor)` then `depositRevenue(amount, periodId, reportHash)` | CHAIN |

### 5.6 `asset_owner_yield_share_waterfall_distribution`

| Element | Source | Verdict |
| --- | --- | --- |
| `#settlement-epoch` | Issuer-chosen `periodId` (demo convention `YYYYMM`); past periods from `R.deposits[].periodId` | API (history) / CHAIN (input) |
| `#window` countdown | `reportingDueAt()`, not served | GAP-B (B-1) |
| `waterfall_distribution#split-allocation` amounts (and `#investor-apr`, `#protocol-fee`) | Preview for an entered amount × live split (B-1). History uses `R.deposits[]` `holder`, `reserve`, `operator`, `protocol` exactly | GAP-B / API |
| `waterfall_distribution#tilt-condition` "40% sinking if solvency < 95%" | **Wrong rule.** Behind schedule (`M.reserveSchedule.behindSchedule`) → holders 40 / reserve 45 / operator 10 / protocol 5. Show the served flag, not a 95% threshold | API + copy fix |
| `waterfall_distribution#reconciliation` kWh, SWIFT MT799, L/C | — | NOT IMPL |
| `waterfall_distribution#merkle-receipt` / report hash | The issuer supplies `reportHash` to `depositRevenue`; history shows `R.deposits[].reportHash` | CHAIN / API |
| `waterfall_distribution#batch-call` three destinations | There is one call, `depositRevenue`, and the contract allocates. The mockup omits the 5% protocol share; include it | CHAIN / copy fix |
| `#amount` (display only in mockup) | Must be an input. The write is `depositRevenue(amount, periodId, reportHash)`, which reverts `NoYieldEligibleSupply()` when `supply.eligibleCirculating` is 0 | CHAIN |
| `waterfall_distribution#historical-ledger` | `R.deposits[]`, all columns, plus a protocol column | API |
| `waterfall_distribution#operator-claim` | `R.operatorAccrued` (display). Write: `RevenueDistributor.claimOperatorRevenue()`, operator only | API / CHAIN |
| `#destination-treasury` select (multisig / SPV / bank wire) | — | NOT IMPL (the claim goes to the operator address) |
| `waterfall_distribution#sinking-floor-move` "$0.390", "+2.63%", chart | `M.floor.price` + `covered` now; history via `FloorLevelUp` activity (B-3). Reserve per token is a different number: `M.reserveSchedule.currentBacking` | API / DERIVE |
| `#total-sinking` | `M.reserve.redemptionReserve` | API |
| `waterfall_distribution#treasury-bills`, `waterfall_distribution#multisig-console` (indenture, jurisdiction, zero liens, paymaster, 3-of-5) | — | NOT IMPL |

### 5.7 `arcreserve_logo`, `arcreserve_brand_emblem`

No data. The emblem's tagline "SOVEREIGN ASSET LAYER" implies state backing; see §9. The desktop headers
load the logo from a remote Google-hosted URL; ship it as a local asset.

---

## 6. Screen-to-endpoint matrix

Columns: **Endpoint** is this file's column; **Contract / event** and **Status** are Contract Arch's
(PRODUCT_KNOWLEDGE.md), and this file will adopt them verbatim once published. Endpoint abbreviations
follow §5.

| Screen | Primary endpoints | Chain reads / writes | Backend gaps hit | NOT IMPL surface |
| --- | --- | --- | --- | --- |
| `launchpad_offerings` | `L` (per chain), `M` (featured), `A` (KYC badge) | `isVerified`, `buy` via CTA | B-1 (split), B-5 (TVL) | APR, pipeline terms, whitelist/data-room, audits |
| `launchpad_offerings_desktop` | same + `/candles` (none needed), `detail.metadataURI` | same | B-1, B-5, metadata resolver | TVL delta, default history, telemetry, SPV/Basel copy |
| `asset_detail_secondary_trading_solar01_1` | `M`, `L.change24h`, `/candles`, `/nav-history`, `/activity?type=FloorLevelUp`, `/swap-quote`, `R`, `/redemptions`, `A`, `detail` | `balanceOf`, `allowance`, `swapExactInput`, `approve(manager)`, `claimRevenue`, `redeem`, `transferRestriction` | B-3, B-7, B-8 | APR, SCADA, ratings, CertiK, Chainlink, cost-basis beyond window |
| `asset_detail_secondary_trading_solar01_2` | as `_1` + `/candles?interval=3600&limit=24` (volume) | as `_1` | as `_1` | as `_1` |
| `asset_owner_listing_flow` | — pre-deploy; `M` post-deploy | `submitAsset` | B-1 | drafts, documents, verifier queue |
| `asset_owner_listing_flow_desktop` | as above | as above | B-1 | as above + audits copy |
| `asset_owner_listing_flow_step_1_asset_classification` | — | `submitAsset` (name, category, metadata) | metadata authoring | classes, risk tiers, LTV, eligibility, production history |
| `asset_owner_listing_flow_step_2_capital_structuring` | `M.offering`, `/positions` (post-deploy) | `classLimits` | — | Reg S / QIB, SPV |
| `asset_owner_listing_flow_step_3_revenue_sinking_schedule` | `M.reserveSchedule` (post-deploy) | — | B-1 | simulator, escalation 3–5, oracles |
| `asset_owner_listing_flow_step_4_legal_spv_binding` | `detail.metadataHash`, `detail.termsHash` | — | — | SPV, trustee, deeds, signatories |
| `asset_owner_listing_flow_step_5_verifier_review_vault_ignition` | `/v1/assets?status=Pending|Approved`, `detail`, `M.nav`, `/v1/health` (post-deploy sync) | `approveAsset`, `beginAssetSystem`, `completeAssetSystem`, `abandonAssetSystem`, `isPending` | — | pre-flight checklist, verifier SLA, paymaster |
| `asset_owner_operational_reports_document_filing` | `/v1/health`, `R.deposits[].reportHash`, `detail.metadataHash` | `depositRevenue` (report hash) | B-1 | document store, oracle fidelity, liens, comments |
| `asset_owner_infrastructure_telemetry_monitoring` | `M`, `R`, `L` (issuer filter), `/activity` | `approve(distributor)`, `depositRevenue` | B-1, B-2 | all telemetry, ratings, SPV |
| `asset_owner_yield_share_waterfall_distribution` | `R`, `M.reserveSchedule`, `M.floor`, `M.reserve`, `/activity?type=FloorLevelUp` | `approve(distributor)`, `depositRevenue`, operator claim | B-1, B-3 | kWh reconciliation, T-bills, treasury routes, indenture |
| `arcreserve_logo` / `arcreserve_brand_emblem` | — | — | — | tagline copy |

---

## 7. Gaps: backend work vs NOT IMPLEMENTED

### 7.1 Backend work: the chain has the data, no endpoint serves it

None of these is started. Each would be a Boundary C change row. Until one lands, the listed fallback
applies.

| ID | Gap | Screens | Fallback until served |
| --- | --- | --- | --- |
| **B-1** | Revenue covenant state: `activeSplit()` (the split in force), `isReportingOverdue()`, `reportingDueAt()`. Add to `/metrics`, read at the indexed block like the rest | offerings, all asset-owner screens | Read on chain with viem and label `onchain`. Never hardcode 60/25/10/5 |
| **B-2** | `?issuer=` filter on `/v1/assets` | telemetry monitoring | Client-side filter of the list |
| **B-3** | Complete history for rare activity types (floor level-ups): a type filter in SQL, or a `/floor-history` route. Today `?type=` filters a recent window (§4.1) | asset detail chart, waterfall ratchet | Show current `M.floor` only, or label the series "recent" |
| **B-4** | Asset metadata resolver: fetch `metadataURI`, verify against `metadataHash`, serve parsed fields with `provenance` | offerings, asset detail | Client fetch of the URI, with integrity check against `metadataHash` shown |
| **B-5** | Cross-asset, cross-chain aggregates (total vault balance, raised) | offerings desktop ribbon | Client sum over per-asset `metrics`, labelled `derived` |
| ~~**B-6**~~ | ~~Swap quote~~ | asset detail trade desk | **CLOSED 2026-09-13** — `GET /v1/assets/:id/swap-quote?tokenIn=&amountIn=` (Boundary C row, 2026-09-13). A live `eth_call` of the real `swapExactInput`, not a reimplementation; use it instead of a client-side `simulateContract`. Returns `spent` alongside `amountOut` (a same-day fix, caught by Contract Arch — the raw contract call cannot return `spent` on its own, so it's recovered by an exact saturation test costing up to ~12s on a large, partially-filling order). |
| **B-7** | Eligible circulating supply at each revenue deposit (for payout per token) | asset detail ledger | Omit the column; do not divide by today's supply |
| **B-8** | Pool fee tier (`pool.fee()`) and par value (`maturityParValue()`) in `/metrics` | asset detail | Chain read; par = `reserveSchedule.targetBacking` |
| **B-9** | Boundary doc §3.7 drift: `stableBalance`, `allowances`, `marketValue` are documented but not served | asset detail position | Chain reads / client derive (§4) |

### 7.2 NOT IMPLEMENTED: no contract and no backend

Contract Arch's PRODUCT_KNOWLEDGE classifies these on the product side. From the backend side, **none
has a data source**, and several would need a new off-chain service, meaning a product decision in
`docs/DECISIONS.md` before any code:

- **Forward yield / APR projections, default history, credit ratings, TVL trend.** No data; publishing
  them is a yield claim.
- **IoT, SCADA, energy telemetry, oracle fidelity, hardware health, Chainlink PoR.** Nothing emits them.
- **Document store and IPFS pinning, filing ledger, OCR, encryption, verifier comments and SLA queue,
  notifications, watchlist or bookmark, data-room access, whitelist requests.** These would need a
  stateful off-chain service with user data, which is out of the current backend scope (read-only
  indexer, no user store).
- **Listing wizard drafts and eligibility pre-qualification.** Client-local state at most.
- **SPV, trustee, liens, signatories, Basel/Reg S/BMA status, audits, relayer, paymaster, multisig
  treasury routing, bank off-ramp.** Hackathon scope (CLAUDE.md): no legal entity, no audit, single
  admin key.
- **Escrowed or threshold fundraising, partial/failed settlement, refunds of a raise.** Target only. The
  offering mints immediately.

The rule for all of them (product rule 10): **remove, or render as a clearly labelled "illustrative /
not live" preview. Never as a live figure.**

---

## 8. Known gaps in the current frontend

These are verified in `frontend/` as of this writing. They matter because the Stitch build will likely
start from this code.

1. **No `chainId` on any API call.** Every hook in `frontend/src/lib/queries.ts` (`useAssets`,
   `useMetrics`, `useCandles`, `usePositions`, `useActivity`, `useAccountPosition`, `useNavHistory`) omits
   `?chainId=`. On the one-URL deployment every panel therefore silently shows **the serving process's
   chain (Hedera)**, including on Arc's asset page. Query keys also omit the chain, so a chain switch
   serves the previous chain's cache. Fix: add `chainId` to every path and every query key.
2. **Single-chain address set.** `frontend/src/lib/contracts.ts` builds one address set from
   `NEXT_PUBLIC_*` env vars, so it cannot express two chains, and §2.3 shows why keying by address alone
   is unsafe. Fix: a `chainId → addresses` map.
3. **Stale revenue-deposit ABI.** `contracts.ts:41` declares `depositRevenue(uint256)` and
   `operator-forms.tsx:35` passes one argument, but the contract is
   `depositRevenue(uint256 amount, uint256 periodId, bytes32 reportHash)` (Boundary A, BREAKING
   2026-08-30). The selector differs, so the call reverts. This is the only arity mismatch; Contract Arch
   checked every other declared write.
4. **Writes the Stitch screens need that are absent from the frontend:** `approveAsset` (3 args, no
   verifier approve flow), `swapExactInput` (`action-deck.tsx:43` still says a router is "intentionally
   not included", superseded by D-035/D-037), `DemoRegistrar.selfRegister`, `claimOperatorRevenue`,
   `depositReserve`, `FloorController.levelUp`, `resumeAsset`. Signatures: PRODUCT_KNOWLEDGE.md.
   `submitAsset`'s ABI matches, but `operator-forms.tsx:22` sends hardcoded values rather than form inputs.
5. **No KYC gating.** There is no `isVerified`, no `transferRestriction` preflight and no `selfRegister`
   anywhere in `frontend/src`, and no `useWaitForTransactionReceipt` either.
6. **Fixture numbers inside live components.** `action-deck.tsx:62` falls back to `"142.80"` claimable;
   `:70` and `:72` preview with `/1.018` and `*0.82`; `engine/page.tsx:14` shows a static "All safety gates
   clear" and `:30` a static safety list, including the removed Spot/TWAP and Market/NAV rows. There is no
   `safetyState` read.
7. **TWAP still drawn.** `price-chart.tsx:196` draws a "30m TWAP" line whenever `twap` is non-null, and
   `api.ts:180` still types `windowSeconds`. The API serves `null`, so nothing draws today, but the code
   path and the legend should be **deleted**, not re-pointed (rule 5).
8. **Hardcoded keeper ticks.** `engine-controls.tsx:13` passes `[-276540, -275940]`, which is wrong-signed
   or misaligned depending on deployment ordering (rule 8).
9. **Slippage `0`.** `buy` and `redeem` pass a minimum out of `0` (`action-deck.tsx`).

---

## 9. Design copy that must change before it ships

CLAUDE.md "Scope: hackathon only" forbids presenting the demo as regulated, audited, guaranteed or
yield-promising. The Stitch HTML does all four. Integrators should not port the copy verbatim.
Contract Arch's PRODUCT_KNOWLEDGE may extend this list.

| Claim in the design (examples) | Why it cannot ship | Replace with |
| --- | --- | --- |
| "Base Sepolia" (chip, footers, deploy button) | Parked; live chains are Hedera and Arc | The connected chain's name |
| "Dual-Audited Vaults (CertiK & Zellic)", "Smart contracts audited by OpenZeppelin", "CertiK Security Score", "Audit Ref" | No audit has been performed | Nothing, or "unaudited testnet demo" |
| "Regulated under Basel III", "Reg S / 144A", "Reg D 506(c)", "Bermuda Monetary Authority", "Tier 1 Validated" | No regulatory status | "Testnet demo; not a regulated offering" |
| "Guaranteed floor", "contractually guaranteed", "irrevocable letter of guarantee", "Offtaker Guaranteed", "Protected Exit" | No guarantee exists. The floor is a reference, not a bid; redemption is reserve- and period-limited | "Published floor reference (covered: yes/no)", "Redemption quote" |
| "Est. Cash Yield 14.8% APR", "Target APR", "Dividend Distributions", "coupon", "Auto-staking" | Yield promise, dividends | "Revenue distributions (realized)", with no forecast |
| "Parity", "Par Peg", "Genesis Par Peg" | Implies a peg | "Schedule target backing" |
| "Bankruptcy-Remote SPV", "Delaware Series LLC", "UCC-1", "first-priority mortgage", "ArcReserve Foundation Ltd." | No legal entity | Remove |
| "ERC-3643 KYC Compliant", "ERC-4626" | The token is ERC-3643-*shaped*, not certified; the vault is not ERC-4626 | "Permissioned token (demo KYC: anyone can self-verify on this testnet)" |
| Named real firms: JLL, CertiK, Chainlink, Schneider Electric, Standard Chartered, Baker McKenzie, Consensys, PT Unileverindo | Implies relationships that do not exist | Remove, or use obviously fictional names |
| "redeemable on demand", "instant settlement, zero penalties", "0 Price Impact" | Redemption is period- and reserve-limited; price impact is real | Show the live limits and the quote |
| "SOVEREIGN ASSET LAYER" | Implies state backing | "Real assets. Programmable liquidity." (the product tagline) |

---

*Maintained by the backend agent. Update this file in the same change as any `/v1` shape change, and
record the change in `docs/stacks/BACKEND_TO_FRONTEND.md` §6.*
