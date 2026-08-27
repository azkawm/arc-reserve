# Frontend Specification and Integration Status

Status: implemented visual prototype with selected live wallet actions and mostly fixture-based reads.

The frontend is under `frontend/` and uses Next.js 15 App Router, React 19, TypeScript, wagmi, viem,
TanStack Query, Tailwind CSS, Lucide icons, and Recharts.

## 1. Routes

| Route | Purpose | Data status |
| --- | --- | --- |
| `/` | Marketplace and pipeline | Static fixtures |
| `/assets/solar-indonesia-01` | Asset market, chart, supply, issuer, actions | Hybrid fixture plus selected writes/read |
| `/engine` | Position visualization and keeper controls | Fixture visualization plus selected writes |
| `/issuer` | Target settlement preview and issuer forms | Fixture preview plus selected writes |
| `/verifier` | Review queue and verifier actions | Fixture queue plus selected writes |

Shared navigation and wallet controls are in `src/components/app-shell.tsx` and
`src/components/wallet-button.tsx`.

## 2. Environment

The app expects:

```text
NEXT_PUBLIC_RPC_URL
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_MUSD_ADDRESS
NEXT_PUBLIC_REGISTRY_ADDRESS
NEXT_PUBLIC_TOKEN_ADDRESS
NEXT_PUBLIC_VAULT_ADDRESS
NEXT_PUBLIC_OFFERING_ADDRESS
NEXT_PUBLIC_MARKET_MANAGER_ADDRESS
NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS
NEXT_PUBLIC_REDEMPTION_CONTROLLER_ADDRESS
NEXT_PUBLIC_ASSET_ID
```

`contractsConfigured` becomes true only when all eight component addresses are nonzero. The app is
configured for chain ID 31337 and the local RPC by default.

The local deployment JSON does not automatically update `.env.local`. After every fresh Anvil
restart:

1. rerun `DeployLocal.s.sol`;
2. copy current addresses and asset ID into `.env.local`;
3. restart the Next.js dev server; and
4. reconnect the wallet to Anvil.

Do not commit real secrets. All `NEXT_PUBLIC_*` variables are shipped to the browser.

## 3. Current data model

`src/lib/data.ts` contains the visual demo state:

- asset profile and issuer profile;
- market, NAV, TWAP, floor, redemption, and reserve values;
- supply and vesting figures;
- OHLC candle history;
- marketplace pipeline;
- four liquidity-position cards; and
- keeper/rebalance history.

These values are not synchronized with the contracts. They deliberately tell a coherent demo story,
but must remain labeled as mock, demo, policy preview, or fixture until replaced by indexed reads.

`src/lib/contracts.ts` contains minimal ABIs and environment-derived addresses. It is not a generated
ABI layer and does not include every contract function or event.

## 4. Action matrix

| UI action | Current behavior | Important caveat |
| --- | --- | --- |
| Connect wallet | Live wagmi connector | User must select local chain |
| Approve mUSD for buy | Live ERC-20 `approve` | No allowance read/step orchestration |
| Buy SOLAR01 | Live `PrimaryOffering.buy` | UI preview uses 1.018 market fixture, contract offering price is 1.000000 |
| Sell SOLAR01 | Not implemented | Displays a preview message only; no router adapter |
| Claim holder revenue | Live `claimRevenue` | Claimable read is live when configured; otherwise displays fixture fallback |
| Redeem | Live Normal-mode `redeem` | UI estimate uses 0.82 fixture and does not call live quote first |
| Submit asset | Live registry call | Current form ignores displayed editable fields and submits hardcoded values |
| Approve/deposit reserve | Live | Seeded demo already has an initial reserve; repeated deposit adds reserve |
| Approve/deposit revenue | Live | Caller must have revenue depositor role |
| Publish NAV | Live | Caller must have verifier role and remain within movement limit |
| Suspend/default/mature | Live | Maturity call reverts before the timestamp |
| Rebalance/slide/sweep | Live | Uses one hardcoded tick range and assumes correct keeper role/state |
| Verifier queue approve/reject buttons | Visual only | Buttons have no handlers |
| Marketplace filters/search | Visual only | No state/filter implementation |

## 5. Known correctness gaps

These are high-priority when replacing fixtures:

1. **Buy preview mismatch:** the preview divides by the 1.018 mock market price, while the offering
   mints at its immutable 1.000000 mUSD price.
2. **Redemption preview mismatch:** the UI multiplies by a mock 0.82 instead of reading
   `redemptionPrice(mode)` and checking period/reserve limits.
3. **Claim fallback ambiguity:** when the live query is unavailable, claimable revenue displays
   `142.80` without an explicit error state.
4. **Static balances:** wallet mUSD, SOLAR01, holdings, and market value are fixtures.
5. **Static safety badge:** “All safety gates clear” does not call `safetyState`.
6. **Static position composition:** ranges and mUSD/SOLAR01 amounts do not come from manager or pool.
7. **Hardcoded keeper ticks:** `EngineControls` always submits `[-276540, -275940]`, which may be
   unaligned with the active position lifecycle or wrong for token ordering.
8. **Transaction lifecycle:** success means wallet submission, not confirmation or indexer inclusion.
9. **No chain guard:** the user experience does not strongly block writes on the wrong network.
10. **Mixed policy/live surfaces:** target escrow and partial-settlement visuals sit beside live MVP
    controls; badges help, but all future additions must preserve the distinction.
11. ~~Encoding artifacts~~ — resolved; a byte scan on 2026-08-27 found only valid UTF-8 punctuation.
12. **KYC-blind (since D-021, 2026-08-27):** the token is permissioned. Any wallet other than the
    registered demo accounts gets a raw `RecipientNotVerified()` revert on buy. No verification
    badge, no `transferRestriction` pre-check, no explanation. This is task 0 in the frontend brief.

### 5.1 Full audit findings (2026-08-27)

Recorded so the frontend agent does not rediscover them. File references are as of the audit.

**Correctness / safety**
- `action-deck.tsx`: `{claimable ? formatUnits(claimable, 6) : "142.80"}` — a failed, disconnected,
  **or legitimately zero** read renders the fixture (`0n` is falsy). Violates D-019.
- `action-deck.tsx`: `buy(..., 0n)` and `redeem(..., 0n, 0)` — no slippage floor; redemption mode
  hardcoded to Normal.
- `engine-controls.tsx`: one fixed tick pair `[-276540, -275940]` for `rebalanceToNAV`, `slide`,
  `sweep`; sign-locked to `assetIsToken0 == true`; not idempotent after a successful move; differs
  from the seeded anchor `[-276600, -276000]`. The `engineAbi` is declared inline, not in
  `contracts.ts`.
- `operator-forms.tsx`: the "Register an asset" inputs are uncontrolled `defaultValue`s never read;
  `submitAsset` always sends the hardcoded "Solar Indonesia 02" literals and
  `keccak256(toHex("solar-indonesia-02"))`.
- No `useWaitForTransactionReceipt` anywhere; "Submitted 0x…" is shown on broadcast; no refetch of
  `claimableRevenue` after `claimRevenue`.
- No chain guard: `wagmiConfig` has only chain 31337 and nothing calls `useChainId`/`useSwitchChain`.
- `contractsConfigured` requires all eight addresses including the never-used `addresses.token`;
  validation is `startsWith("0x")` only.
- `IssuerForms.guard()` checks `contractsConfigured` but not `isConnected`.
- Raw `error.message` rendered to users; `engine-controls` truncates at 100 chars.
- `wagmi.ts`: `ssr: true` without cookie storage → wallet state lost on reload; `injected()` only;
  no `blockExplorers`, so no tx links.

**Dead / non-functional UI**
- Marketplace search input and the four filter buttons have no state or handlers.
- Asset-page tab bar (Overview / Documents / Cash flow / Activity): dead buttons.
- `/verifier` review-queue buttons (Open metadata / Reject / Approve): no handlers; `approveAsset` is
  not in `registryAbi`.
- `price-chart.tsx`: `period` state set by 1H/1D/1W/1M but never consumed; Y-domain hardcoded
  `[0.78, 1.06]`.
- Asset-page "copy address" button has no `onClick`.
- Nav labels `/assets/solar-indonesia-01` as "Activity".

**Data / architecture**
- 14 of 25 ABI entries are unused (`navOf`, `redemptionPrice`, `redemptionReserve`,
  `reserveRatioBps`, `isSolvent`, `circulatingSupply`, `yieldEligibleBalanceOf`, `yieldExcluded`,
  `balanceOf`, `allowance`, `faucet`, `stablecoinRaised`, `availableTokenInventory`) — exactly the
  reads that would replace hardcoded numbers with no backend.
- Most numeric fields of `solarAsset` are never read; the same values are duplicated as JSX string
  literals across four files (`1.018` ≥ 8 places, `0.820`, `24,600`, supply figures, `38.4%` bar
  widths). Swapping the fixture will not change the UI until those literals go.
- `data.ts` stores pre-formatted display strings (`"24.6k mUSD"`, `"0.700 - 0.880 mUSD"`,
  `"+60 ticks"`, `time: "09:00"`); `engine-chart.tsx` duplicates the band bounds as literals rather
  than reading `liquidityPositions`.
- Route is the literal folder `assets/solar-indonesia-01`, not `assets/[slug]`.
- Tailwind is installed and configured but unused; all styling is hand-written in `globals.css`.
- `dev-server*.log` and `tsconfig.tsbuildinfo` sat in the frontend root (now git-ignored).

**Provenance labelling today**
- The only clear label is the chart's "Mock market feed" chip. `position-liquidity.tsx` says "Mock
  live balances" (contradictory). Every `Metric` card on `/engine`, `/issuer`, `/verifier`, the
  marketplace stats band and hero, the asset header price, floor callout, reserve card, supply
  panel, safety-gates list, verifier review grid, and all `ActionDeck` previews are unlabelled
  fixtures indistinguishable from the one genuinely live figure (claimable revenue).

## 6. Chart implementation

`PriceChart` uses a Recharts `ComposedChart`:

- custom `Bar` shape for candle wicks and bodies;
- bullish and bearish colors;
- TWAP line;
- NAV dashed line;
- protected-floor dashed line; and
- static 1H/1D/1W/1M buttons that currently change selection only.

It does not use the TradingView widget or TradingView Lightweight Charts. It does not fetch OHLC.

The correct future source is indexed canonical pool `Swap` events. See `BACKEND_INDEXER.md`. If the
chart library is changed, preserve:

- OHLC candles;
- independent NAV/TWAP/floor overlays;
- exact timestamps and interval selection;
- source/staleness labels;
- accessible tooltip values; and
- explicit empty/no-trade buckets.

## 7. Position liquidity presentation

The four cards intentionally separate:

- market floor range;
- intermediary;
- anchor; and
- discovery.

Their displayed token composition is currently fixture data. `AssetMarketManager.positions` returns
ticks and abstract liquidity, not the current token0/token1 amounts. Production composition requires
canonical V3 liquidity math plus current price and position fee state.

Never combine the 24,600 mUSD protected reserve fixture with the market position balances.

## 8. Proposed frontend read architecture

Use three layers:

```text
backend/indexer reads -> historical and aggregate protocol data
direct viem/wagmi reads -> execution-critical current state and wallet-specific values
explicit fixture adapter -> demo mode only
```

Recommended query modules:

```text
src/features/assets/queries.ts
src/features/market/queries.ts
src/features/account/queries.ts
src/features/revenue/queries.ts
src/features/redemption/queries.ts
src/features/engine/queries.ts
```

Every query result used for market UI should expose:

- value in raw and formatted form;
- chain ID;
- source block and timestamp;
- provenance;
- loading/error/stale status; and
- whether the value is safe for transaction preview.

## 9. Proposed write architecture

Move inline write construction into typed feature actions. Each action should:

1. verify connected chain;
2. validate user input without JavaScript floating point;
3. perform required live reads/simulation;
4. show allowance or role prerequisites;
5. submit the wallet transaction;
6. wait for receipt;
7. invalidate affected queries; and
8. optionally wait for indexer inclusion.

Suggested action state:

```text
idle -> validating -> approval-required -> awaiting-wallet -> submitted
     -> confirmed -> indexed
     -> rejected / reverted / indexing-delayed
```

Do not show a transaction hash as final success before receipt confirmation.

## 10. Page migration plan

### Phase 1: correctness labels

- Add a standard `DataSourceBadge` for Live, Derived, Mock, and Stale.
- Remove silent numeric fallbacks from transactional cards.
- Show connected chain and deployment block.
- Separate target-policy panels visually from current-contract panels.

### Phase 2: wallet and execution reads

- mUSD and SOLAR01 balances and allowances.
- offering price, raised, inventory, limits, and time window.
- live claimable revenue.
- live redemption price, reserve liquidity, and period remaining.
- market `safetyState`, positions, and policy.

### Phase 3: backend reads

- marketplace assets and status.
- asset metrics and activity.
- OHLC and volume.
- NAV history.
- vault category history.
- liquidity/rebalance history.

### Phase 4: transaction UX

- simulations and typed errors;
- receipts and indexer reconciliation;
- wrong-network prompts;
- slippage/minimum-output controls; and
- role-aware operator controls.

## 11. Copy rules

Preferred wording:

| Use | Avoid unless legally established |
| --- | --- |
| Asset participation token | Equity, share certificate, ownership token |
| Protected floor reference | Guaranteed floor, peg |
| Reserve-limited redemption | Guaranteed 1:1 exit |
| Verified NAV | Live market value |
| Revenue distribution | Dividend |
| Floor accretion | Guaranteed yield |
| Authorized capped supply | Unlimited mint |
| Target policy preview | Live contract behavior |

Every asset page should eventually show market price, TWAP, NAV and timestamp, protected floor,
redemption quote, reserve, reserve ratio, issued supply, excluded supply, circulating eligible supply,
maximum supply, maturity, and status separately.

## 12. Accessibility and responsive requirements

- All actions must remain keyboard accessible.
- Charts require a text/table alternative for candle and reference values.
- Color cannot be the only indicator for status or candle direction.
- Transaction errors need concise summaries plus expandable details.
- Mobile layouts must preserve price labels and disclaimers.
- Loading skeletons must not resemble confirmed numeric values.
- Mock and stale states need visible text, not tooltip-only disclosure.

## 13. Validation commands

From `frontend/`:

```powershell
npm run typecheck
npm run lint
npm run build
npm run dev
```

For UI changes, test at least:

- disconnected wallet;
- wrong chain;
- correct Anvil chain with missing addresses;
- correct chain with current deployment;
- rejected wallet request;
- contract revert;
- RPC failure;
- backend stale/error; and
- narrow mobile viewport.
