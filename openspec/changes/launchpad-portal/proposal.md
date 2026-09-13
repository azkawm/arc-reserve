## Why

The public surface today is the labelled concept landing page (`concept-landing-page`, D-036). It tells the
product's story from static copy and reads the backend nowhere. The surface the product actually needs — the
Stitch **launchpad portal** — was explicitly deferred by that change and does not exist: there is no router,
no chain context, no `/v1` wiring, and no wallet write.

`docs-handover/` (`PRODUCT_KNOWLEDGE.md`, `INTEGRATION_GUIDE.md`, `FRONTEND_INTEGRATION_PLAN.md`) reconciles
the Stitch reference against the deployed contracts and the `/v1` API. This change builds the **demo-critical**
slice of that reconciliation: a judge can open the offerings, choose SOLAR01, and complete the on-chain
journey — faucet, self-verify, buy, swap both ways, claim, redeem — on **Hedera 296** and **Arc 5042002**,
seeing only values that trace to a contract, an endpoint, or a labelled derivation.

The owner's direction: the design's wrong elements are **redesigned to show the real figure**, not deleted;
the offerings screen **defaults to Hedera** with a chain switch to Arc; and the build lives in
`arc-reserve/frontend`.

## What Changes

- **Routing and chain context.** Add a router and a chain context. The offerings screen defaults to **Hedera
  (`chainId` 296)** and offers a switch to **Arc (`chainId` 5042002)**. Every request and query key carries
  the chain.
- **Per-chain configuration.** Replace the single env-var address set with a `chainId → addresses` map read
  from `contracts/deployments/296.json` and `5042002.json`; add both chains to wagmi with a chain guard that
  blocks writes on the wrong network.
- **Live data wiring.** Put `?chainId=` on every hook and read `meta.chainId` back; add the
  `CHAIN_UNAVAILABLE` and `QUOTE_UNAVAILABLE` error codes; align the response types with the backend schemas;
  remove the retired TWAP path. A failed read renders an error/unknown state, never a fixture.
- **Offerings screen (Stitch `launchpad_offerings` / `_desktop`, guide §5.1).** Real name, status, raise
  progress, price, minimum, NAV, floor with coverage, reserve solvency, and closes-in from `/v1`;
  chain-keyed list.
- **SOLAR01 trading desk (Stitch `asset_detail_secondary_trading_solar01_1`/`_2`, guide §5.2).** The four
  distinct prices (spot, NAV, floor reference, redemption price) kept separate; a chart that shows "No trades
  yet" instead of a flat line; position, claim, and redeem panels.
- **Wallet writes (plan §W).** `faucet`, `DemoRegistrar.selfRegister` (gated on `canSelfRegister && isActive`),
  `PrimaryOffering.buy` (approve offering), `AssetMarketManager.swapExactInput` (approve manager, explicit
  **1,000,000** gas, quote-first, `amountSpent` and refund shown), `RevenueDistributor.claimRevenue`, and
  `RedemptionController.redeem` (no approval). Mapped revert names, receipt confirmation, and indexer
  reconciliation.
- **Copy and figure honesty.** Each **WRONG** element in `PRODUCT_KNOWLEDGE.md` §3–§4 is replaced by the real
  figure or an explicit "not implemented" state — no audit, regulatory, guarantee, APR, or named-firm claim.
- **Non-Goals.** The owner-side screens (listing wizard, telemetry, document filing, waterfall — plan
  B.5–B.13) are out of scope for this change and remain previews or later work.

## Capabilities

### New Capabilities

- `portal-shell`: routing, the chain context and chain switch (default Hedera), the per-chain address map,
  and the chain guard that governs every write.
- `live-data-integration`: the rules for reading `/v1` — `chainId` on every call, envelope and provenance
  handling, nullable and error states, and the "never a fixture" boundary.
- `offerings-screen`: what the offerings list contains and which figures it may show.
- `asset-trading-desk`: the SOLAR01 detail screen — the four distinct prices, chart states, position,
  redemption quote, and claim.
- `wallet-writes`: the on-chain actions and their preflight, gas, quote, confirmation, and refusal rules.

### Modified Capabilities

- None. `openspec/specs/` is empty; `concept-landing-page` added its capabilities as a delta but has not been
  synced to a main spec. The `stitch-design-system` tokens are reused unchanged, not modified.

## Impact

- **Modified:** `frontend/src/App.tsx` (router), `frontend/src/lib/api.ts`, `queries.ts`, `contracts.ts`,
  `wagmi.ts`; `frontend/src/main.tsx` / providers as needed.
- **New:** route components and screens under `frontend/src/` following the existing `components/` and `lib/`
  layout; a wallet-action module; a deps map.
- **Dependency:** one router library (see design.md; open question).
- **Removed:** the TWAP code path in the client types (already serving `null`).
- **Docs:** `docs/FRONTEND.md` and `docs/DECISIONS.md` move with the code; the deferred deep-dive note in
  `FRONTEND.md` is superseded by this change.
