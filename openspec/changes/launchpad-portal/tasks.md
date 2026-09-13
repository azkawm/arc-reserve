## 1. Multi-chain foundation

- [x] 1.1 Add a chain context/provider exposing the active chain (default Hedera 296) and a switch to Arc 5042002, and assert the active chain on the route
- [x] 1.2 Build a `chainId → addresses` map from `contracts/deployments/296.json` and `5042002.json`; replace the single env-var address set in `lib/contracts.ts`
- [x] 1.3 Add Hedera 296 and Arc 5042002 to `lib/wagmi.ts` (Hedera nativeCurrency 18-dec HBAR; Arc nativeCurrency 18-dec USDC) while keeping Anvil for local dev
- [x] 1.4 Add a chain guard: a write is disabled and offers `switchChain` until the wallet chain equals the page chain
- [x] 1.5 Add the router and the route table (`/`, `/offerings`, `/assets/:slug`), keeping the landing page's in-page anchors working
- [x] 1.6 Build the portal shell: top navigation and the chain switch (default Hedera)

## 2. Live data client corrections

- [x] 2.1 Thread the active `chainId` through every hook in `lib/queries.ts` and include it in every query key
- [x] 2.2 Add `CHAIN_UNAVAILABLE` and `QUOTE_UNAVAILABLE` to `ApiErrorCode` in `lib/api.ts`, and map `MOCK_DISABLED` on candles to a "no trades yet" state
- [x] 2.3 Align `lib/api.ts` types with `backend/src/api/schemas/` (metrics: `marketStatus`, `nav.expiresAt`/`staleAfterSeconds`, `floor.covered`, `reserveSchedule`, `redemptionPrice`), reading the schemas, not the design
- [x] 2.4 Delete the TWAP field and any overlay/typing; grep finds only a comment explaining the removal
- [x] 2.5 Implement the panel states: loading, error (never a fixture), not-indexed (`asOf === null`), stale, chain-unavailable, chain mismatch, degraded, backfill-pending
- [x] 2.6 Read `meta.chainId` back on every response and treat a mismatch as an error
- [x] 2.7 Render provenance per panel from the field's own provenance when present, else the envelope's

## 3. Offerings screen (Stitch `launchpad_offerings` / `_desktop`)

- [x] 3.1 Restyle the offerings screen to the reference using the existing tokens, with the real figures from guide §5.1
- [x] 3.2 Wire name, symbol, category, status, and issuer from `/v1/assets?chainId=`
- [x] 3.3 Wire the featured card's raise progress (`offering.raised` / `offering.cap`), remaining, issue price (`offering.price`), minimum (`offering.minimumPurchase`), closes-in (`offering.endsAt`), NAV (`nav.value` with staleness), floor (`floor.price` **with `floor.covered`**), and reserve solvency (`reserveSchedule`)
- [x] 3.4 Redesign the WRONG tiles to real figures: yield/APR → trailing realised distributions or not-implemented; audit/CertiK/JLL → removed or provenance; "Base Sepolia" → the connected chain's name
- [x] 3.5 Show pipeline cards only from real `Pending`/`Approved` assets returned by `/v1/assets?status=`; otherwise omit
- [x] 3.6 Gate the "Verify me" affordance on `canSelfRegister(wallet) && isActive()`; show the KYC badge from `IdentityRegistry.isVerified`

## 4. SOLAR01 trading desk (Stitch `asset_detail_secondary_trading_solar01_2`)

- [x] 4.1 Restyle the detail screen to the reference using the existing tokens and the `_2` variant (drop the "auto-staking" copy)
- [x] 4.2 Header and metrics: `detail.status`, `detail.contracts.token` with the chain named, and `meta.asOf`/`meta.stale` for freshness
- [x] 4.3 Render the four distinct prices separately: spot (`metrics.spot`, gated on `marketStatus === "ready"`), NAV (with age), floor (`metrics.floor.price` with `covered`), redemption price (`metrics.redemptionPrice.normal`)
- [x] 4.4 Chart: candles from `/candles` with "No trades yet" on `503 MOCK_DISABLED`; NAV step line from `/nav-history`; floor steps from `/activity?type=FloorLevelUp` labelled "recent"; parity baseline from `reserveSchedule.targetBacking`
- [x] 4.5 Position panel from `A.tokenBalance`, `A.claimable`, and client-derived market value labelled `derived`; spendable = balance − `frozenTokens`
- [x] 4.6 Redeem panel: quote from `A.redemptionQuote` / `metrics.redemptionPrice.normal` **not the floor**, show NAV age, period remaining in **tokens**, and the disabled states (`issuerAllocation`, `frozen`, status ≠ Active)
- [x] 4.7 Redesign the WRONG elements: "redeem at the $0.38 floor", "0 price impact", "0.05% protocol fee", the ratchet rate, and the removed Spot/TWAP and Market/NAV safety rows

## 5. Wallet writes

- [x] 5.1 `MockUSD.faucet()` (any wallet), confirm `FaucetUsed`
- [x] 5.2 `DemoRegistrar.selfRegister()` gated on `canSelfRegister && isActive`, confirm with `IdentityRegistry.isVerified`
- [x] 5.3 `PrimaryOffering.buy(amount, minimumTokensOut)`: approve **offering**, minimum from a quote minus a visible tolerance, never `0`
- [x] 5.4 `AssetMarketManager.swapExactInput(tokenIn, amountIn, minAmountOut, deadline)`: approve **manager**, quote first, **explicit 1,000,000 gas**, show `amountSpent` and the partial-fill refund, disable a dry direction with its reason
- [x] 5.5 `RevenueDistributor.claimRevenue()`, reading `claimableRevenue(wallet)` first
- [x] 5.6 `RedemptionController.redeem(tokenAmount, minimumStablecoinOut, 0)`: no approval step, minimum from the quote
- [x] 5.7 Transaction lifecycle (`idle → … → indexed`) with `useWaitForTransactionReceipt`, then `/v1/health` indexer reconciliation for the active chain
- [x] 5.8 Decode reverts with the ABI and show the error name; never "transaction failed"
- [x] 5.9 Preflight on every write: disconnected → wrong chain → unverified → `transferRestriction` non-zero with its mapped reason

## 6. Unit tests

- [x] 6.1 Query paths: every hook builds a path with `chainId`, and a query key containing the chain
- [x] 6.2 Envelope/error parsing: `meta.chainId` mismatch throws; `asOf: null` → not-indexed; `503 CHAIN_UNAVAILABLE` and `503 MOCK_DISABLED` map to their states
- [x] 6.3 Provenance: a field-level provenance overrides the envelope's
- [x] 6.4 Safety-failure map: indices 0–8 exactly, with 4/5/6 present and marked reserved
- [x] 6.5 Tick ↔ price: equivalent ticks under `assetIsToken0 = true` and `false` give the same human price
- [x] 6.6 Swap summary formatting: raw amounts get the right decimals from `tokenIn` vs `contracts.token`; refund shown only when `amountRequested > amountSpent`
- [x] 6.7 Null handling: `change24h`, `spot`, `floor`, `redemptionQuote` null render a dash, never `0`
- [x] 6.8 Negative copy test: no audit firm, no "guaranteed", no "peg", no forward-APR claim in the portal's rendered text
- [x] 6.9 Contract-shape fixtures: one recorded response per route per chain, parsed by the frontend types (test-only, never in the app)

## 7. Responsive tests

- [x] 7.1 No horizontal overflow at phone, tablet and desktop on `/offerings` and `/assets/:slug`
- [x] 7.2 The chain switch and navigation stay reachable below the desktop breakpoint
- [x] 7.3 Wide tables/charts scroll within their own container

## 8. Documentation and verification

- [x] 8.1 Add a decision record for the router/library choice and the chain-context model
- [x] 8.2 Update `docs/FRONTEND.md`: the portal surface, the chain context, and the end of the "no consumer" interval
- [x] 8.3 Update the copy rules with the redesigned floor/yield/par/verification wording
- [x] 8.4 Run the full gate — typecheck, lint, unit tests, browser tests, build — and record the results
- [ ] 8.5 Manual demo checklist on both chains: fresh wallet → faucet → verify → buy → swap both ways → claim → redeem, plus wrong-chain, unverified, disconnected, API-down and degraded states (plan §E.4) — documented in `docs/TESTING.md` §14; requires a wallet and the live backend, run by the owner
