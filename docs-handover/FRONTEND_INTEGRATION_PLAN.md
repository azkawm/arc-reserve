# Frontend integration plan: the Stitch portal on the real contracts and API

**Owner:** backend session (arcreserve-9b). Section W, wallet writes, is authored by Contract Arch and
pasted here verbatim; nobody else edits it.

**Read first:**
1. [`PRODUCT_KNOWLEDGE.md`](PRODUCT_KNOWLEDGE.md): what each screen means on chain, and its status.
2. [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md): which endpoint supplies each number, and the 14 rules.

This plan does not repeat either. It says what to build, in what order, and how to know it is done.

**Status:** draft, 2026-09-13. Not committed; the owner reviews first. No frontend session is active, so
this is written for someone starting cold.

---

## Contents

- [A. Prerequisites](#a-prerequisites)
- [B. Per screen](#b-per-screen)
- [C. Existing frontend defects to fix first](#c-existing-frontend-defects-to-fix-first)
- [D. Milestones](#d-milestones)
- [E. Test plan](#e-test-plan)
- [F. Open decisions for the owner](#f-open-decisions-for-the-owner)
- [W. Wallet writes (Contract Arch)](#w-wallet-writes-contract-arch)

---

## A. Prerequisites

### A.1 Repository state (measured 2026-09-13)

| Fact | Consequence |
| --- | --- |
| Worktree `arc-reserve-frontend` is on `frontend/kyc-and-correctness` at `f708d8c`, **73 commits behind `main`, 0 ahead**, with a clean tree. Its `frontend/src/lib` has only `contracts.ts`, `data.ts` and `wagmi.ts`. | It predates the API migration: no `api.ts`, `queries.ts`, `fixtures.ts`, `format.ts`, or the panel components. **Fast-forward it to `main` before any work.** Starting from the branch as-is would rebuild the API layer from scratch. |
| Local `main` is **7 commits behind `origin/main` and 19 ahead**. The 7 include the owner's `feat/frontend` PR (#1), `stitch-ui/`, deploy scripts and an nginx setup. The 19 are unpushed backend and contracts work. | Bringing `origin/main` in is a **merge or rebase, not a fast-forward**. Several sessions share this tree, so the owner decides who integrates and when (F-4). Do not force-push, and do not reset either side. |
| `frontend/package.json` has `dev`, `build`, `start`, `lint` and `typecheck`, and **no test runner** | E adds Vitest |
| `frontend/src/lib/wagmi.ts` configures **Anvil only** | A.2 |

### A.2 Per-chain configuration

**API.** Use one base URL (`NEXT_PUBLIC_API_URL`) and put `?chainId=` on **every** call and in **every**
React Query key (guide §2.1). The serving process needs `CORS_ORIGIN` to include the frontend's origin.

**Wallet chains.** Add both chains to wagmi. These values are taken from the backend's verified chain
client, `backend/src/chain/client.ts`:

| | Hedera testnet | Arc testnet |
| --- | --- | --- |
| `id` | `296` | `5042002` |
| `nativeCurrency` | `{ name: "HBAR", symbol: "HBAR", decimals: 18 }` | `{ name: "USD Coin", symbol: "USDC", decimals: 18 }`. **18, not 6**, measured |
| Public RPC the backend uses | `https://testnet.hashio.io/api` (no JSON-RPC batching) | `https://arc-testnet.drpc.org` (batch ≤ 3; getLogs ≤ ~100 blocks) |
| Multicall3 | not configured | `0xca11bde05977b3631167028862be2a173976ca11`, block 1 |

Keep Anvil for local development. Drop Base Sepolia from the product UI; it is parked. Never use a wallet's gas
estimate for `swapExactInput`: send an explicit 1,000,000 on every chain (W, action 4).

**Addresses.** Build a `chainId → addresses` map from `contracts/deployments/296.json` and
`contracts/deployments/5042002.json` (the root keys are flat). Look up per-asset components from
`/v1/assets/:assetId?chainId=` `contracts`, and key every address by `(chainId, address)` (guide §2.3:
two addresses are different contracts on the two chains). Replace the single `NEXT_PUBLIC_*_ADDRESS` set in
`frontend/src/lib/contracts.ts`. Never hardcode a `DemoRegistrar`: Arc's was redeployed on 2026-09-13 and its address changed (guide §2.4).

**Chain guard.** Before any write, the wallet's chain must equal the page's chain. Otherwise offer
`switchChain` and disable the action. The page's chain comes from the route or selector, never from
whatever the wallet happens to be on.

### A.3 Design system

The Stitch tokens are in `literary_intelligence/DESIGN.md` inside the zip:
- **Fonts:** Newsreader (display, 400) and Inter (UI, 400/500).
- **Palette:** a warm off-white canvas (`#f9faf7`/`#fefffc`), ink text (`#171717`–`#646464`), dusk filled
  buttons (`#1f1f29`), and signal blue (`#41a1cf`) for outlined actions only.
- **Shape:** 4–8 px button radii, 12–16 px card radii, hairline `#dee2de` borders, a 1200 px max width.

The current app is a dark theme, so this is a restyle, not a token swap. Load the fonts through
`next/font`. Ship the logo as a local asset; the mockups hotlink it from a Google-hosted URL.

The landing page in `stitch-ui/` on `origin/main` is a separate design from the same owner PR (F-5).

### A.4 Running it locally against live testnets

- **Services:** port `:4000` serves `/v1` for both chains; `:4001` is Arc's indexer worker, not an API to
  call.
- **Data:** both chains hold the full demo history: deploy, seed, and one flywheel swap each (verified by
  receipt diff).
- **Mock data:** `ALLOW_MOCK_MARKET_DATA` stays `false`. Every chart state must work without mock data.

---

## B. Per screen

### B.0 UI states every data panel must implement

Every panel listed in B.1–B.16 implements all of these unless its row says otherwise.

| State | Trigger | Render |
| --- | --- | --- |
| Loading | Query pending | Skeleton, with no numbers |
| Error | Transport error or `5xx`/`4xx` body | Error with retry; **never a fixture** |
| Not indexed yet | `meta.asOf === null` | "Not indexed yet" |
| Stale | `meta.stale === true` | Values plus a Stale badge and "as of" time |
| Chain unavailable | `503 CHAIN_UNAVAILABLE` | "This deployment cannot serve <chain>". The asset is not dead |
| Bad chain | `400 BAD_REQUEST` naming indexed chains | Chain picker error |
| Chain mismatch | `meta.chainId` ≠ requested | Error. Never render the other chain's data |
| Degraded service | `/v1/health` `status === "degraded"` | Subtle banner. **Not** an error; normal during catch-up |
| Backfill pending | `/v1/health` `pendingBackfills` lists this chain | "Syncing" on compliance, identity and floor panels for that chain |
| Risk unknown | `riskCoverage.notComputed` lists this chain | "Risk not computed". Never "no risk" |
| No trades yet | `/candles` → `503 MOCK_DISABLED` | "No trades yet". Not an empty chart |
| Provenance | Every value | Badge from the field's own provenance if it has one, else the envelope's |

Wallet-action panels additionally implement:

- **Before submitting:** wallet disconnected → wrong chain → unverified wallet (with a "Verify me" gate
  on `canSelfRegister`) → `transferRestriction` non-zero, with its mapped reason.
- **Swap only:** quote first. If `pool.liquidity()` is 0 or the quote is 0, disable Swap with "No market
  liquidity right now" instead of letting the wallet reach `InvalidSwapDirection`. The pools were empty
  earlier on 2026-09-13 and are re-armed now (F-9, done), but they empty again as they trade. **Cap the
  input near the quoted depth:** about 135 mUSD for buys and about 176 mUSD for sells per re-arm. A buy of about
  250 mUSD or more makes every later buy revert until a keeper re-arms.
- **Transaction lifecycle:** `idle → validating → approval-required → awaiting-wallet → submitted →
  confirmed → indexed`, terminating in `rejected`, `reverted` (with the mapped error) or
  `indexing-delayed`. "Indexed" means `/v1/health` `indexers[]` for that chain has
  `blockNumber ≥ receipt.blockNumber`.

### B.1–B.16 Screens

Column key: **Data** is the guide §5 section with its key endpoints. **Writes** refers to section W.
**Proposed scope** is only a proposal until the owner decides F-1.

| # | Screen | Data | Writes | NOT IMPLEMENTED to label or cut | Blockers | Proposed scope |
| --- | --- | --- | --- | --- | --- | --- |
| B.1 | `launchpad_offerings` | Guide §5.1: `/v1/assets` on **both** chains merged, `metrics` for featured, account route for the KYC badge | Navigation to buy (W: approve + `buy`) | APR/yield, pipeline terms, whitelist, data room, audit badges | B-1 split (guide §7.1) | **Ship.** Cut the NOT IMPL tiles |
| B.2 | `launchpad_offerings_desktop` | As B.1, plus a client-summed TVL ribbon (guide B-5) and metadata fields via `metadataURI` (guide B-4) | As B.1 | TVL trend, default history, telemetry box, SPV/Basel copy | B-4 metadata resolver (client fetch is the fallback) | **Ship.** Ribbon limited to real figures |
| B.3 | `asset_detail_secondary_trading_solar01_1` | Guide §5.2: `metrics`, `candles`, `nav-history`, `activity`, `revenue`, `redemptions`, account, `positions` | W: `swapExactInput` (approve manager), `claimRevenue`, `redeem` (no approval), `selfRegister`, `levelUp` (optional) | SCADA, credit rating, CertiK, Chainlink, APR, "auto-staking" | Thin two-way market after the F-9 re-arm: buy depth ~135 mUSD and sell depth ~176 mUSD, with one flywheel turn per re-arm. B-3 floor history (show current floor only); B-6 quote (use `simulateContract`) | **Ship.** This is the core judge screen |
| B.4 | `asset_detail_secondary_trading_solar01_2` | As B.3, plus 24 h volume from hourly candles; relabel "liquidity" as the vault market allocation | As B.3 | As B.3 | As B.3 | Pick **one** variant with the owner (F-6); do not build both |
| B.5 | `asset_owner_listing_flow` | None before deploy; `metrics` after | W: `submitAsset` | Drafts, documents, verifier queue, SLA | No draft store (none planned) | Merge into B.7–B.11 or cut (F-1) |
| B.6 | `asset_owner_listing_flow_desktop` | As B.5 | As B.5 | As B.5 plus audit copy | As B.5 | As B.5 |
| B.7 | `asset_owner_listing_flow_step_1_asset_classification` | None (only `name` and `category` reach the chain) | W: `submitAsset` (the final step collects these) | Risk tiers, LTV, eligibility, production history, telemetry source | No metadata authoring or pinning | **Preview**, labelled; one real form field set |
| B.8 | `asset_owner_listing_flow_step_2_capital_structuring` | Post-deploy `metrics.offering` and `positions`; class caps via chain read | None (deployment parameters are hashed at approval) | Reg S / QIB, SPV, "audited ERC-4626" | Parameters have no pre-deploy home except the verifier's `termsHash` input | **Preview**; the 65/30/5 split is a fixed explainer |
| B.9 | `asset_owner_listing_flow_step_3_revenue_sinking_schedule` | Post-deploy `metrics.reserveSchedule`; live split needs B-1 | None | Simulator, escalation steps 3–5, oracles | B-1 | **Preview**; the 60/25/10/5 and 40/45/10/5 explainer is accurate |
| B.10 | `asset_owner_listing_flow_step_4_legal_spv_binding` | `detail.metadataHash`, `detail.termsHash` | None | SPV, trustee, liens, deeds table, signatories | No legal entity (hackathon scope) | **Cut** to a "Commitments on chain" panel showing the two hashes (F-1). The panel states that `termsHash = keccak256(abi.encode(DeploymentParams))` and that deployment reverts `TermsMismatch` otherwise. The design's "Merkle root of legal documents" is wrong, so it cannot survive even as a preview label |
| B.11 | `asset_owner_listing_flow_step_5_verifier_review_vault_ignition` | `/v1/assets?status=Pending|Approved`, `detail`, `metrics.nav`, health for post-deploy sync | W: `approveAsset` (verifier), `beginAssetSystem` → `completeAssetSystem` (**same wallet**), `abandonAssetSystem` | Pre-flight checklist, verifier SLA, paymaster or sponsored gas | Role-gated (VERIFIER / ISSUER); judges cannot run it with fresh wallets | **Ship, gated per action:** `approveAsset` only for VERIFIER_ROLE; ignition only for the asset's issuer, with both phases from the same wallet. Gating them together would offer the verifier a deploy that reverts `UnauthorizedIssuer`. Hidden from judges |
| B.12 | `asset_owner_operational_reports_document_filing` | Health block; `revenue.deposits[].reportHash`; `detail.metadataHash` | W: `depositRevenue` (report hash) | Document store, OCR, oracle fidelity, liens, comments, PoR PDF | B-1 (overdue/due date) | **Cut** to a "Revenue reports on chain" list (F-1) |
| B.13 | `asset_owner_infrastructure_telemetry_monitoring` | `metrics`, `revenue`, issuer-filtered `/v1/assets`, `activity` | W: `approve(distributor)` + `depositRevenue` | **All telemetry**, ratings, SPV, failover | B-1, B-2 | **Cut telemetry.** Keep an "Asset monitoring" subset with NAV × supply, reserve schedule, revenue and activity (F-1) |
| B.14 | `asset_owner_yield_share_waterfall_distribution` | `revenue`, `metrics.reserveSchedule`, `metrics.floor`, `metrics.reserve` | W: `approve(distributor)`, `depositRevenue(amount, periodId, reportHash)`, `claimOperatorRevenue` | kWh reconciliation, T-bills, treasury routes, indenture | B-1 (live split; derive from `behindSchedule` meanwhile) | **Ship.** It is real; fix the tilt rule copy |
| B.15 | `arcreserve_logo` | — | — | — | — | Ship as local SVG |
| B.16 | `arcreserve_brand_emblem` | — | — | "SOVEREIGN ASSET LAYER" tagline | — | Ship with the product tagline |

Every screen also applies the copy replacements in guide §9.

---

## C. Existing frontend defects to fix first

These are verified in `frontend/src` on `main`, 2026-09-13. Each is a precondition for the Stitch build:
building new screens on top of these would carry the defect into them.

| # | Defect | Where | Fix | Done when |
| --- | --- | --- | --- | --- |
| C-1 | No `chainId` on any API call or query key | `lib/queries.ts` (every hook) | Chain in every path and key; a chain context provider | A request log shows `chainId` on 100 % of `/v1` calls; switching chains refetches |
| C-2 | Single-chain address set | `lib/contracts.ts:7-17` | `chainId → addresses` map (A.2) | No `NEXT_PUBLIC_*_ADDRESS` read remains in components |
| C-3 | Wallet config is Anvil only | `lib/wagmi.ts` | Add 296 and 5042002 (A.2) | Wallet connects and switches between both |
| C-4 | No KYC gating: no `isVerified`, no `transferRestriction` preflight, no `DemoRegistrar` `selfRegister` / `canSelfRegister` / `isActive` | whole `src` | Verify gate plus preflight on buy, swap and transfer (W) | A fresh Hedera wallet can self-verify and then buy; an unverified wallet sees the reason before signing |
| C-5 | `depositRevenue` ABI is 1-arg; contract is 3-arg (reverts) | `lib/contracts.ts:41`, `components/operator-forms.tsx:35` | `depositRevenue(amount, periodId, reportHash)` with inputs | A deposit succeeds on Hedera and appears in `/revenue` with its `periodId` and `reportHash` |
| C-6 | No verifier approve: `approveAsset(assetId, initialNAV, termsHash)` absent | `lib/contracts.ts`, `app/verifier` | Add ABI and verifier form | Approving a Pending asset moves it to Approved in `/v1/assets` |
| C-7 | `submitAsset` ignores its inputs (hardcoded "Solar Indonesia 02") | `components/operator-forms.tsx:22` | Bind the form | A submitted name and category appear as Pending |
| C-8 | Hardcoded keeper ticks `[-276540, -275940]` | `components/engine-controls.tsx:13` | Derive from `/positions` (`tickSpacing`, `assetIsToken0`, `currentTick`) | Ticks are multiples of spacing and within `maxTickShift` on both chains |
| C-9 | `assetIsToken0: false` hardcoded (live: **true** on both chains) | `lib/fixtures.ts:70` | Read per connection; remove from fixtures | No ordering constant remains in `src` |
| C-10 | `"142.80"` claimable fallback | `components/action-deck.tsx:62` | Loading, error or `0` states | Disconnected or failed reads never show a number |
| C-11 | Fake previews `/1.018` (buy) and `*0.82` (redeem); fixed rate and floor text | `components/action-deck.tsx:56,70-75` | Buy from `offering.price`; redeem from `redemptionQuote.price` | Previews match `metrics` for the chain in view |
| C-12 | Static "All safety gates clear" and a static safety list, including removed Spot/TWAP and Market/NAV rows | `app/engine/page.tsx:14,16-19,30` | Render `metrics.safety.failure` with reserved codes 4/5/6 kept in the map | The page shows `None` / `Cooldown` / … from the API; no TWAP or Market/NAV row |
| C-13 | TWAP overlay and legend still in code; `windowSeconds` still typed | `components/price-chart.tsx:112-206`, `components/engine-chart.tsx:20`, `lib/api.ts:180` | **Delete** (guide rule 5) | `grep -i twap frontend/src` finds only a comment explaining the removal |
| C-14 | No `useWaitForTransactionReceipt`; no indexer reconciliation | whole `src` | Lifecycle from B.0, per-chain health poll | Every write reaches "indexed", or "indexing-delayed" with a reason |
| C-15 | No trade path; `action-deck.tsx:43` says the router is "intentionally not included" | `components/action-deck.tsx` | `swapExactInput` with approve-to-manager, an explicit 1,000,000 gas limit, a quote-first liquidity gate, `amountSpent` display and refund notice | A Hedera swap shows spent, received and refund (if any), matching the `Swap` activity summary. With zero pool liquidity, Swap is disabled with its reason. An input above the quoted depth is capped or refused before signing |
| C-16 | Minimum-out `0` on `buy` and `redeem` | `components/action-deck.tsx` | Minimum from the quote minus a visible tolerance | No write passes a literal `0n` minimum |
| C-17 | Company-vesting copy (D-031 removed it) | `components/action-deck.tsx:62` | Remove | No "vesting" string in user copy |

---

## D. Milestones

Each milestone is complete only when all of its acceptance criteria pass **and** the E gates are green.
Order matters: M1 and M2 remove the defects the later screens would otherwise inherit.

### M0: Sync and baseline

- **Work:**
  - Fast-forward `arc-reserve-frontend` to `main`.
  - Once F-4 is decided, bring in `origin/main`.
  - Add Vitest (E).
- **Accept:**
  - `npm run typecheck`, `lint`, `build` and `test` all pass on the synced tree.
  - The app runs against `:4000` on Hedera.

### M1: Multi-chain foundation

- **Work:** C-1, C-2, C-3, the chain guard (A.2), the B.0 state components, and provenance badges from the
  field.
- **Accept:**
  - The existing asset page renders Hedera and Arc from one URL, selected by chain, with `meta.chainId`
    asserted.
  - Stopping the Arc RPC on the API (`CHAIN_UNAVAILABLE`) shows that state, not Hedera data.
  - Unit tests cover query-path construction for both chains.

### M2: Correctness fixes

- **Work:** C-5, C-8 to C-13, C-16, C-17.
- **Accept:**
  - Every "Done when" in those rows holds.
  - `grep` finds no `1.018`, `0.82`, `142.80` or `twap` value literal in components.
  - The safety-failure map test asserts indices 0–8, including 4/5/6.

### M3: Wallet correctness and KYC onboarding

- **Work:** C-4, C-14, C-15, and the W writes used by judges (faucet, `selfRegister`, `approve` + `buy`,
  `approve(manager)` + `swapExactInput`, `claimRevenue`, `redeem`).
- **Accept, on Hedera with a fresh wallet:**
  - faucet → verify → buy → swap (buy ≤ ~10 mUSD, then sell ≤ ~5 SOLAR01) → claim → redeem each reaches
    "indexed". The pools were re-armed on 2026-09-13 (F-9); a buy of about 250 mUSD or more blocks every later
    buy until a keeper re-arms.
  - Every revert path in W renders its mapped message.
  - The swap refund notice appears when `amountSpent < amountRequested`, tested with a unit test on the
    summary formatter.
- **Accept, on Arc:** the same criteria as Hedera, because the `DemoRegistrar` fix is deployed (F-3). If
  `canSelfRegister` ever reads false, the Verify button must hide itself (guide §2.4).

### M4: Stitch asset detail (B.3 or B.4)

- **Work:** restyle to A.3, the guide §5.2 mapping, and the NOT IMPL cuts.
- **Accept:**
  - Every number on the page traces to an endpoint, a chain read or a labelled derivation. A reviewer
    checklist is generated from guide §5.2.
  - NAV, spot, floor (with `covered`) and redemption price are four distinct values.
  - Redeem uses the redemption quote, not the floor.
  - The chart shows "No trades yet" on a chain without swaps (test by pointing at an Anvil deploy with no
    trade).

### M5: Stitch launchpad offerings (B.1, B.2)

- **Accept:**
  - The list merges both chains, keyed by `(chainId, assetId)`.
  - The raise progress matches `metrics.offering`.
  - No APR, TVL trend, default rate or audit badge is present unless F-1 keeps it as a labelled preview.

### M6: Asset-owner screens (B.11, B.14, and the F-1 outcome for B.5–B.10, B.12, B.13)

- **Accept:**
  - **Waterfall (B.14):** a Hedera revenue deposit with `periodId` and `reportHash` shows its
    `holder/reserve/operator/protocol` split from `/revenue`, and the history table matches the API
    exactly.
  - **Role-gated flows (B.11):** approve is shown only to VERIFIER_ROLE and deploy only to the asset's
    issuer. The operator claim on B.14 is shown only to the operator address. Between
    `beginAssetSystem` and `completeAssetSystem` the page shows "deployment in progress".
  - **Previews:** every preview screen carries a visible NOT IMPLEMENTED label.

### M7: Judge journey, demoable

- **Script, fresh wallet:**
  1. Connect.
  2. Faucet mUSD.
  3. Verify me (`selfRegister`).
  4. Buy SOLAR01.
  5. Swap mUSD → SOLAR01, and SOLAR01 → mUSD.
  6. Open the asset timeline.
- **Accept:**
  - The timeline shows, **for this wallet's own transaction hashes**, `IdentityRegistered`, `Purchase`
    and `Swap`, and the flywheel's `FloorLevelUp` from the same swap transaction (the first swap after a re-arm).
    `SurplusCredited` appears only if F-10 stages the large final buy; see the limits below. When a step does not run, the matching `FlywheelSkipped` / `FloorLevelUpSkipped`
    appears with its reason. Both are acceptable; a silent absence is not.
  - The swap shows `amountSpent`, and a refund if partial.
  - The floor panel shows the new level with `covered`.
- **Chains:**
  - **Hedera:** required.
  - **Arc:** required. The `DemoRegistrar` fix is deployed and verified (F-3).
- **Liquidity limits (F-9 done; re-armed 2026-09-13):**
  - **Swap size.** Keep the judge's swaps small: a buy of about 10 mUSD, then a sell of about 5 SOLAR01.
    Buy depth is ~135 mUSD and sell depth ~176 mUSD.
  - **One flywheel turn per re-arm.** The first swap harvests discovery and fires `FloorLevelUp`; later swaps
    log `FlywheelSkipped`.
  - **A reserve credit is conditional (F-10).**
    - Small swaps show `FloorLevelUp` and `FlywheelSkipped(NO_SURPLUS)`.
    - A reserve credit is shown only if the owner stages a single buy of ≥~320 mUSD (400 recommended) as the
      last step. After it, buys stay blocked until keeper recovery.
    - Measured by Contract Arch on forks of both chain heads, first buy from the live state:
      - ≤300 mUSD: no credit;
      - 320: credit 6.35;
      - 400: credit 86.35 (backing 4.359999 → 4.377269);
      - 600: credit 286.35.
    - Credit ≈ size − 313.65; gas ≈515k, within the 1,000,000 rule.
  - **Before each demo,** re-check depth. If a previous demo exhausted it, re-arm with the keeper's
    `removeLiquidity(Anchor)` followed by `ArmMarket`.
- **Baseline, so the check is not vacuous:** both chains already hold one of each of these types from the
  deploy and seed flywheel swap (measured 2026-09-13). Type presence alone proves nothing; match the
  judge's transaction hashes.

---

## E. Test plan

**Add** `vitest` (with `jsdom` for component tests) to `frontend/devDependencies` and a
`"test": "vitest run"` script.

**Gates for every milestone:**

```
npm run typecheck
npm run lint
npm run build
npm run test
```

### E.1 Unit tests (required)

| Area | Assertion |
| --- | --- |
| Query paths | Every hook builds a path with `chainId`, and a query key containing the chain |
| Envelope parsing | `meta.chainId` mismatch throws; `asOf: null` maps to "not indexed"; `503 CHAIN_UNAVAILABLE` and `503 MOCK_DISABLED` map to their states, not to generic errors |
| Provenance | A field-level provenance overrides the envelope's |
| Safety failure map | Indices 0–8 exactly; 4/5/6 present and marked reserved |
| Tick ↔ price | Equivalent ticks under `assetIsToken0 = true` and `false` give the same human price (live chains are both `true`; the test keeps the other branch honest) |
| Swap summary formatting | Raw amounts get the right decimals from `tokenIn` vs `contracts.token`; refund = `amountRequested − amountSpent` shown only when positive |
| Revenue split explainer | `behindSchedule` → 40/45/10/5, else 60/25/10/5 |
| Null handling | `change24h`, `spot`, `floor`, `redemptionQuote` null render a dash, never `0` |

### E.2 Contract-shape tests

- Keep `lib/api.ts` types aligned with `backend/src/api/schemas/assets.ts` and `health.ts`.
- Recorded responses from `:4000`, one per route per chain, are checked in as fixtures **for tests only**
  and parsed by the frontend types. A backend shape change then fails the frontend test instead of the
  demo.
- These fixtures never reach the running app (guide rule 1).

### E.3 Smoke tests (optional, tagged, not in the default run)

Run against a live `:4000`:
- `/v1/health` is healthy or degraded;
- both chains return SOLAR01 with the expected `meta.chainId`;
- Hedera candles return `canonical_swap`.

### E.4 Manual demo checklist (per chain, before any demo)

The M7 script, plus:
- wrong-chain wallet;
- unverified wallet;
- disconnected wallet;
- API down (error, not a fixture);
- health `degraded`.

---

## F. Open decisions for the owner

Each item has a recommendation; the owner's word overrides it.

| # | Decision | Recommendation |
| --- | --- | --- |
| F-1 | Which NOT IMPLEMENTED screens ship as labelled previews, and which get cut | **Ship:** B.1–B.4, B.11 (gated per action: the verifier approves, the issuer deploys), B.14. **Preview, labelled:** B.7–B.9. **Cut or reduce:** B.10 legal SPV → a "commitments on chain" panel (only `termsHash` / `metadataHash` exist); B.12 document filing → "revenue reports on chain" (only `reportHash`); B.13 telemetry → "asset monitoring" without telemetry; B.5/B.6 merged into the stepper. Escrowed or threshold settlement is target-only and not shown |
| F-2 | Accept the copy replacements in guide §9 (no audit, regulation, guarantee, APR, SPV, named firms) | Accept. CLAUDE.md requires it |
| F-3 | Arc `DemoRegistrar` redeploy and role switch | **Done 2026-09-13** (owner-approved). The new registrar `0xF6f77D0b…` holds `REGISTRY_AGENT_ROLE`, and the old `0x86738829…` was revoked. `isActive`, `canSelfRegister(fresh)` and a `selfRegister` simulation all pass on chain, verified by both Contract Arch and the backend session. Read the address from `deployments/5042002.json` |
| F-4 | Integrating `origin/main` (7 behind, including `feat/frontend` and `stitch-ui`) with local `main` (19 unpushed ahead) | One session merges, after the backend and contracts commits are pushed or reviewed; not a force-push |
| F-5 | How the `stitch-ui` landing page relates to the portal (separate route, or replace `/`) | Landing at `/`, portal under `/offerings` |
| F-6 | Asset detail variant `_1` or `_2` | `_2` for the volume tile, without the "staking" copy |
| F-7 | Priority of backend gaps B-1…B-9 (guide §7.1) | B-1 (revenue covenant state) first; then B-4 (metadata); then B-3 (floor history) |
| F-8 | Who builds it: a frontend session is needed | Start one on M0 with this plan and the two guides |
| F-9 | Re-arm both pools. They held zero liquidity, so every swap reverted. A discovery-only seed supports one buy, because the flywheel harvests all of discovery after each swap and does not re-mint (deferred B-2); sells need anchor or market-floor liquidity | **Done 2026-09-13** (owner-approved "Two-way market": `ArmMarket.s.sol` on both chains). Anchor −275760..−275160 and discovery −275160..−273960, each L=1e16. Depth is thin, and there is one flywheel turn per re-arm; see the M7 limits. The lasting fix is the deferred B-2 re-mint |
| F-10 | Stage a live reserve credit in the demo. A single first buy of ≥~320 mUSD (400 recommended) as the **last** step credits about `size − 313.65` mUSD to the reserve, but blocks later buys until keeper recovery | Owner's call; the measurement shows it is possible. If not staged, M7 shows `FloorLevelUp` plus `FlywheelSkipped(NO_SURPLUS)`, and the earlier on-chain `SurplusCredited` from the seed swap remains visible in the timeline |

---

## W. Wallet writes (Contract Arch)

Authored by Contract Arch and received by message on 2026-09-13. It is pasted below verbatim inside a
text block, so its formatting is preserved exactly; nobody else edits it. The same table, with element
keys, is §5–§7 of [`PRODUCT_KNOWLEDGE.md`](PRODUCT_KNOWLEDGE.md).

**Gas conclusion (Contract Arch, 2026-09-13), replacing the earlier hold.**

- **Where it failed.** A trace of the failed Hedera swap `0xbf808ac3` shows the trade, the discovery
  harvest and `creditMarketSurplus` all succeeded. It then ran out of gas inside
  `FloorController.canLevelUp()`, and the out-of-gas escaped the try/catch.
- **Exact-gas sweep on a fork of the pre-failure state:**
  - ≤510k execution gas reverts;
  - 520–560k reverts after the surplus credit (the mined transaction, ~542k after intrinsic gas, fell
    here);
  - ≥570k succeeds with the full flywheel.

  **No band** makes the swap succeed while skipping a step.
- **Why.** The 1/64 of gas a caller keeps back cannot pay for the catch arm, so an out-of-gas inside the
  flywheel reverts the whole transaction.
- **Receipts mislead.** The successful receipt reports 469,867 after refunds, but a ~592k transaction
  limit is needed.
- **Rule.** Always send an explicit 1,000,000 gas limit on `swapExactInput`, on every chain (action 4 below).
- **Method note.** The first sweep used `cast call --trace`, which ignores `--gas-limit`. Contract Arch
  caught this by testing at 30,000.

**Pool liquidity (update, 2026-09-13).** The pools were empty earlier that day, so every swap reverted
`InvalidSwapDirection()`. Contract Arch then re-armed both (F-9, done):
- anchor and discovery ranges at L=1e16 each;
- buy depth ~135 mUSD and sell depth ~176 mUSD;
- one flywheel turn per re-arm;
- small swaps credit no surplus (`FlywheelSkipped(NO_SURPLUS)`). A single first buy above ≈313.65 mUSD
  credits about `size − 313.65` mUSD to the reserve and blocks later buys. Measured on forks: 320 → 6.35,
  400 → 86.35, 600 → 286.35; gas ≈515k. Whether the demo stages this is plan decision F-10.

**Open point flagged by Contract Arch:** the exact identity pre-check before a buy is unverified. For a
mint, `transferRestriction`'s `from` is presumably the zero address, but that branch has not been read.
Use `IdentityRegistry.isVerified(wallet)` directly, which is certain.

```text
=== WALLET WRITES ===

Rules for every write:
- Decode reverts with the ABI and show the error name. Never show "transaction failed".
- Confirm on the receipt's event, not on the RPC returning a hash.
- Read chain-scoped addresses from deployments/<chainId>.json. One address can be a different contract on another chain.
- mUSD is 6 decimals on every chain; SOLAR01 is 18. On Arc the native gas token is USDC with 18 decimals, which is unrelated to mUSD.

ACTIONS
1. Verify wallet — MISSING FROM THE DESIGN, REQUIRED FOR JUDGES
   DemoRegistrar.selfRegister()   caller: any wallet   approve: none
   confirm: SelfRegistered(wallet, 360, 1). A repeat call is a silent no-op, so confirm with IdentityRegistry.isVerified(wallet)
   gate the button on: DemoRegistrar.canSelfRegister(wallet) && isActive()
   refusal: UnsupportedChain(uint256) — only on a chain the registrar does not support; canSelfRegister reads false there, so the gated button never offers it
   copy: "anyone can self-verify on this testnet"; registers as retail (5,000 mUSD cap)

2. Test mUSD
   MockUSD.faucet()  or  faucet(address recipient, uint256 amount)   caller: any   confirm: FaucetUsed

3. Primary buy — launchpad_offerings#…, "View Offering & Subscribe"
   PrimaryOffering.buy(uint256 stablecoinAmount, uint256 minimumTokensOut)   caller: verified wallet
   approve: mUSD to the OFFERING
   confirm: TokensPurchased
   refusals: RecipientNotVerified, OfferingNotOpen, AssetNotActive, PurchaseTooSmall, FundraisingCapExceeded, WalletLimitExceeded, InventoryExceeded, ZeroTokenOutput, ClassWalletLimitExceeded, ClassAggregateCapExceeded
   pre-check: AssetToken.transferRestriction(address(0)?/offering, wallet, amount) for identity; class limits via PrimaryOffering.classLimits / remainingAllowance

4. Swap / trade — asset_detail_secondary_trading_solar01#swap-panel
   AssetMarketManager.swapExactInput(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline)   caller: any wallet; must be KYC-verified to RECEIVE SOLAR01 (the pool pays the caller directly)
   approve: tokenIn (mUSD or SOLAR01) to the MARKET MANAGER — never the pool, never a router
   confirm: SwapExactInput(trader, tokenIn, amountRequested, amountSpent, amountOut). Display amountSpent; a partial fill refunds amountRequested − amountSpent
   side effects in the same receipt, informational only: MarketSurplusCredited, FloorLevelUp, FlywheelSkipped(reason), FloorLevelUpSkipped(reason)
   FlywheelSkipped(NO_DISCOVERY_LIQUIDITY) is the normal result once discovery has been harvested; show the reason, it is not an error
   refusals: RecipientNotVerified, SenderNotVerified, DeadlineExpired, InvalidSwapDirection, InvalidPoolTokens, SlippageExceeded, paused
   InvalidSwapDirection also means "no liquidity on that side of the pool". Both chains hold a thin two-way market (buy depth ≈135 mUSD, sell ≈176 mUSD); any buy of about 250 mUSD or more blocks every later buy until a keeper re-arms. Quote before sending and cap input near the quoted depth.
   compute minAmountOut from a live quote; 0 is a demo shortcut. Pool fee is 0.30%; the design's "0.05% protocol fee" and "0 price impact" are wrong
   GAS: always send an explicit gas limit of 1,000,000, on every chain; never use the wallet's estimate. Measured: the flywheel needs ≥570k execution gas (~592k transaction limit); below that the WHOLE swap reverts, because out-of-gas inside the guarded post-trade steps escapes their try/catch. A successful receipt reports only ~470k after refunds, so never size the limit from a past receipt. Hedera's eth_estimateGas returned 563,841, inside the failing band; Arc's estimate was not measured

5. Redeem — asset_detail_secondary_trading_solar01#instant-redeem
   RedemptionController.redeem(uint256 tokenAmount, uint256 minimumStablecoinOut, uint8 mode)   mode 0 = Normal   caller: holder
   approve: NONE (tokens burn via AssetToken.burnForRedemption under REDEMPTION_CONTROLLER_ROLE)
   quote: redemptionPrice(0) = min(NAV, backing) — 1.000000 today, NOT the floor price the design shows
   confirm: Redeemed(holder, mode, tokens, stablecoin, nav, price)
   refusals: PeriodLimitExceeded (25,000 SOLAR01 per 1-day period — tokens, not mUSD), InsufficientReserveLiquidity, ZeroRedemptionValue, IssuerAllocationCannotRedeem, MaturityWindowClosed, InvalidMode
   show NAV age beside the quote: NAV binds at 4.36× backing and nothing on chain checks staleness

6. Claim yield — asset_detail_secondary_trading_solar01#claim-yield
   RevenueDistributor.claimRevenue()   caller: holder   confirm: RevenueClaimed   refusal: NoRevenueToClaim   read first: claimableRevenue(wallet)

7. Raise the floor (optional public action)
   FloorController.levelUp()   caller: any   confirm: FloorLevelUp   refusals: AssetNotActive, CooldownActive, FloorCeilingExceeded   gate on canLevelUp()

8. Submit asset — asset_owner_listing_flow#submit-for-review
   AssetRegistry.submitAsset(string name, string category, string metadataURI, bytes32 metadataHash, uint64 maturityTimestamp)   caller: issuer wallet (recorded as issuerOf)   confirm: AssetSubmitted

9. Approve asset — …step_5#submit-final-cosign (verifier screen, not the issuer's)
   AssetRegistry.approveAsset(bytes32 assetId, uint256 initialNAV, bytes32 termsHash)   caller: VERIFIER_ROLE
   termsHash MUST equal keccak256(abi.encode(DeploymentParams)) for the exact params the issuer will deploy, or deployment reverts TermsMismatch. It is not a document Merkle root, whatever the design says
   confirm: TermsApproved + NAVUpdated + AssetStatusChanged(→Approved)
   refusals: InvalidStatus, InvalidNAV, InvalidTermsHash, AccessControlUnauthorizedAccount

10. Deploy — …step_5#ignition-button. TWO transactions from ONE wallet (D-033)
    AssetFactory.beginAssetSystem(DeploymentParams)   caller: the asset's issuer   confirm: AssetSystemBegun
    AssetFactory.completeAssetSystem(bytes32 assetId, DeploymentParams)   caller: SAME wallet as phase 1   confirm: AssetSystemDeployed (fires once)
    escape hatch: abandonAssetSystem(bytes32) → AssetSystemAbandoned
    between phases the asset reads Approved and the vault rejects deposits with SystemNotActive(). Show "deployment in progress"; detect with isPending(assetId)
    refusals: AssetNotApproved, UnauthorizedIssuer, UnapprovedPoolFactory, TermsMismatch, AlreadyDeployed, AlreadyBegun, NotBegun, AssetIdMismatch, InvalidConfiguration
    gas: begin ≈11.8M / complete ≈14.6M limits at forge's default multiplier. Hedera caps a transaction at 15M, so use a reduced estimate multiplier there (115% worked); Arc's block limit is 30M

11. Issuer reserve
    AssetVault.depositInitialReserve(uint256)   caller: issuer   approve: mUSD to the VAULT   confirm: InitialReserveDeposited
    AssetVault.depositReserve(uint256 amount, uint256 periodId)   caller: issuer   approve: mUSD to the VAULT   confirm: ReserveContribution
    refusals: UnauthorizedIssuer, SystemNotActive

12. Withdraw issuer proceeds
    AssetVault.withdrawIssuerProceeds(uint256)   caller: issuer   confirm: IssuerProceedsWithdrawn
    refusals: UnauthorizedIssuer, ReserveShortfallActive (after the 30-day grace), InsufficientCategoryBalance

13. Distribute revenue — asset_owner_yield_share_waterfall_distribution#batch-call, …telemetry_monitoring#execute-distribution
    RevenueDistributor.depositRevenue(uint256 amount, uint256 periodId, bytes32 reportHash)   caller: REVENUE_DEPOSITOR_ROLE
    approve: mUSD to the REVENUE DISTRIBUTOR
    split applied: activeSplit() — 60/25/10/5, or 40/45/10/5 when vault.isBehindSchedule() at the moment of deposit
    confirm: RevenueDeposited
    refusals: AccessControlUnauthorizedAccount, NoYieldEligibleSupply
    FRONTEND BUG: contracts.ts:41 and operator-forms.tsx:35 use a 1-arg depositRevenue and always revert

14. Operator allowance — …waterfall_distribution#operator-claim
    RevenueDistributor.claimOperatorRevenue()   caller: operator address only   confirm: OperatorRevenueClaimed   refusals: UnauthorizedOperator, NoRevenueToClaim

15. Verifier NAV and status
    AssetRegistry.publishNAV(bytes32 assetId, uint256 newNAV)   VERIFIER_ROLE   confirm: NAVUpdated   refusals: NAVMovementTooLarge (>20%), InvalidStatus, InvalidNAV
    suspendAsset / resumeAsset / markDefault / markMatured (bytes32)   VERIFIER_ROLE   confirm: AssetStatusChanged

PER-CHAIN GOTCHAS
- Hedera 296: its eth_estimateGas for swapExactInput landed inside the failing band (see action 4); a 15M per-transaction cap (only the factory phases approach it); the relay keeps its own nonce counter that diverges under rapid sends, so send wallet transactions sequentially and wait for each receipt.
- Arc 5042002: the DemoRegistrar was redeployed 2026-09-13, so read its address from deployments/5042002.json; gas paid in USDC (18 decimals); the free dRPC tier returns intermittent HTTP 408s, so treat a timeout as "unknown, re-check the receipt", not as failure.
- Both: explicit 1,000,000 gas limit on swapExactInput. The backend can lag the chain; after a write, prefer the receipt over an immediate API re-read.

BLOCKERS FOR THE PLAN
- Arc judge flow: fixed 2026-09-13; read the address from the deployment record.
- depositRevenue arity bug in the current frontend.
- No frontend code yet for swapExactInput, approveAsset, selfRegister, the two-phase deploy, depositReserve, claimOperatorRevenue, levelUp.
- Thin two-way market (re-armed 2026-09-13 by ArmMarket): one flywheel turn per re-arm; a large buy blocks later buys until manual keeper recovery. The lasting fix is the deferred B-2 discovery re-mint.
```
