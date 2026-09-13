## Context

`frontend/` is a React 19 + Vite 8 + TypeScript SPA with Tailwind v4, shadcn/ui, wagmi, viem, and TanStack
Query (D-035). The Stitch light visual system is already ported (`concept-landing-page`, D-036): parchment
ground, ink text, cerulean accent, Inter + Newsreader, tight radii. The `/v1` client, fixture adapter,
provenance components and formatters exist in `src/lib/` and `src/components/data-source.tsx` but have **no
consumer** on the current single landing page.

`docs-handover/` is the source of truth for this work. `PRODUCT_KNOWLEDGE.md` says what each screen element
means on chain and whether it is LIVE, DERIVED, NOT IMPLEMENTED or WRONG; `INTEGRATION_GUIDE.md` says which
endpoint supplies each number and lists the rules an integrator gets wrong; `FRONTEND_INTEGRATION_PLAN.md`
gives the order of work and the verbatim wallet-write signatures (§W). When the design and the contracts
disagree, the contracts win; when the two handover docs disagree about an endpoint, `INTEGRATION_GUIDE.md`
and the backend schemas win.

Measured state of the live system (2026-09-13): Hedera 296 and Arc 5042002 both indexed by one API base URL;
SOLAR01 supply 5,000; NAV 1.000000 mUSD; redemption price = `min(NAV, backing)`; both pools thinly two-way
(~135 mUSD buy depth, ~176 mUSD sell depth, one flywheel turn per re-arm). Base Sepolia is parked.

Constraints this design works under:

- The repository's product rules forbid presenting target behaviour as implemented without labelling. This
  screen reads real data, so the concept framing of the landing page does **not** carry over; instead, every
  value carries its provenance and every unimplemented element is cut or labelled.
- Wallet writes go **direct to contracts**; the backend holds no keys and never signs (guide §1.4).
- There is no CI; tests run locally only.

## Goals / Non-Goals

**Goals:**

- A judge completes the full journey on Hedera and Arc with a fresh wallet, and every number on screen
  traces to a contract read, an endpoint, or a labelled client-side derivation.
- Chain is a first-class dimension from the first line: default Hedera, switch to Arc, never a silent
  fallback to whichever chain the API process serves.
- The four prices never collapse into one, and the two easy mistakes — redemption "paying the floor" and
  reading the floor without its coverage — cannot happen by construction.

**Non-Goals:**

- The owner-side screens (listing wizard, telemetry, document filing, waterfall), the verifier/issuer gated
  flows, and the portfolio/landing story sections. Plan B.5–B.13 stay deferred.
- Pixel-identical reproduction of the Stitch render. The reference is a design source; where it conflicts
  with the contracts the contracts win, and the element is redesigned to the real figure.
- A backend change. This change consumes the existing `/v1` surface; backend gaps (guide §7.1, B-1…B-9) are
  worked around with on-chain reads or labelled derivations, not new endpoints.
- Mainnet, real funds, and any legal/audit/regulatory claim.

## Decisions

### One chain context, threaded through every request and key

`queries.ts` today omits `chainId` on every hook and in every query key. On a one-URL deployment this
silently serves the process's chain (Hedera) on Arc's page, and a chain switch serves the previous cache.
Every hook therefore takes the active `chainId`, appends `?chainId=`, includes it in the key, and the caller
asserts `meta.chainId === requested` — a mismatch is an error, not a render (guide §2.1).

*Alternative considered:* two base URLs, one per chain. The backend serves one URL for both, and Arc's
`:4001` is an indexer worker, not a second API; a second URL would encode a lie.

### Default Hedera, switch to Arc — a control, not a URL

Per the owner, the offerings screen opens on Hedera and a visible switch moves the whole portal to Arc. Chain
is state (context), reflected in the route; it is not inferred from the wallet, so the page and the wallet can
disagree and the chain guard resolves it (below). The wallet's chain changes only through `switchChain`, and
a write is disabled until it matches.

### `chainId → addresses`, never an address alone

The same deployer nonce placed **different contracts at the same address** on the two chains
(`0xECEbb2dA…` is `AssetRegistry` on Hedera and `AssetFactory` on Arc). A single env address set cannot
express that, and looking up by address alone calls the wrong contract with no error. The app builds a
`chainId → addresses` map from `contracts/deployments/<chainId>.json` and keys every address by
`(chainId, address)` (guide §2.3). Per-asset components come from `/v1/assets/:assetId?chainId=` `contracts`
where available.

### The API client's error union grows; TWAP is deleted

`api.ts` is missing `CHAIN_UNAVAILABLE` and `QUOTE_UNAVAILABLE`, which the API returns; a 503 with
`CHAIN_UNAVAILABLE` means "this deployment cannot serve that chain", not a dead asset, and `MOCK_DISABLED`
on candles means "no trades yet", not an empty chart (guide §1.1, rule 13). `twap` is typed non-null but is
always `null` since D-036; the field and any overlay are deleted rather than re-pointed.

### Redesign WRONG elements to the real figure

Per the owner, the reference's WRONG elements are not deleted but redesigned to show what is true. Examples:
the "Sinking Floor / guaranteed" tile becomes the published floor **with its coverage**; "Est. Cash Yield
14.8%" becomes trailing realised distributions (or a "not implemented" state); "Par Peg" becomes the
schedule target backing; the fabricated audit/CertiK/JLL/Chainlink rows become provenance and freshness. This
is a stronger honesty posture than removal: the design keeps its shape, and the reader sees the real value.

### Wallet writes are typed actions with preflight, not inline hooks

Each action follows the sequence in `docs/FRONTEND.md` §9 and plan §W: verify chain → validate input without
float → live reads/simulation → show allowance/role prerequisites → submit → wait for receipt → invalidate →
poll `/v1/health` until the chain's `indexers[]` block ≥ the receipt block. Transaction state is
`idle → validating → approval-required → awaiting-wallet → submitted → confirmed → indexed`, terminating in
`rejected`, `reverted` (with the decoded error name), or `indexing-delayed`. A hash is never shown as success
before receipt confirmation.

Two rules are load-bearing:

- **`swapExactInput` must send an explicit 1,000,000 gas limit on every chain**, never the wallet estimate.
  Measured: an out-of-gas inside the post-trade flywheel escapes its `try/catch`, so below ~570k execution
  gas the whole swap reverts, while the successful receipt reports only ~470k after refunds. Sizing from a
  past receipt is the trap (plan §W, action 4).
- **Quote first, always.** If `pool.liquidity()` is 0 or the quote is 0, the swap direction is disabled with
  "no market liquidity right now"; a saturated quote may take ~12s and shows a distinct loading state.
  `amountSpent` is displayed and a partial fill's refund (`amountRequested − amountSpent`) is shown, not
  hidden.

### KYC is a gate, not a badge

The token is permissioned. `IdentityRegistry.isVerified` drives the badge, but the "Verify me" button is
gated on `DemoRegistrar.canSelfRegister(wallet) && isActive()` so a chain whose registrar is not working
hides the button instead of offering a revert. `selfRegister` is the only path a judge's fresh wallet has to
buy or receive SOLAR01 (guide §2.4, plan §W action 1).

### Routes and shell

- `/` — the existing concept landing page, unchanged.
- `/offerings` — the offerings list (B.1/B.2).
- `/assets/:slug` — the SOLAR01 trading desk (B.3/B.4), slug resolved to the `bytes32` assetId by the
  existing `useAssetBySlug`.

The shell gains the top navigation and the chain switch; the landing page's in-page anchor nav remains valid
at `/`.

### Testing split

Vitest + jsdom keeps unit behaviour: query-path construction for both chains, envelope/error mapping
(`CHAIN_UNAVAILABLE`, `MOCK_DISABLED`, `meta.chainId` mismatch, `asOf: null`), provenance precedence, the
safety-failure map including reserved codes 4/5/6, tick↔price under both `assetIsToken0` orderings, swap
summary formatting and the refund rule, and null-vs-zero rendering. Playwright keeps layout at phone, tablet
and desktop, per the existing two-runner split. Recorded per-route, per-chain responses are checked in as
**test-only** fixtures and parsed by the frontend types so a backend shape change fails a test, never the
demo.

## Risks / Trade-offs

- **The API lags the chain after a write.** → The rule is receipt-first: confirm on the receipt's event, then
  poll `/v1/health` for the chain's indexer to catch up before refetching; show `indexing-delayed` if it does
  not.
- **Thin market depth makes a demo swap revert after a large trade.** → Quote first, cap the input near the
  quoted depth, disable a dry direction with its reason, and re-arm before a demo using the keeper's
  `removeLiquidity(Anchor)` + `ArmMarket`. The lasting fix (discovery re-mint) is a deferred backend/contract
  item, noted not solved here.
- **A stale NAV prices redemptions, and nothing on chain blocks it.** → The redeem panel shows NAV age beside
  the quote, and never promises an "instant" or "guaranteed" exit.
- **Router choice is a dependency decision.** → Recorded as an open question; the recommendation is
  `react-router` v7 in library mode (see Open Questions).
- **Removing the TWAP type might break a current consumer.** → There is none on the landing page; the field
  is `null` from the API today, so the removal is a type-level cleanup with a test asserting no TWAP string
  remains.

## Migration Plan

No data migration; no contract change. The change is additive to the app and destructive only to the
client/types that must change. Sequencing matters:

1. Chain context and per-chain addresses land **before** any screen, so no panel is ever authored against a
   single chain.
2. `api.ts`/`queries.ts` corrections land **before** the screens consume them.
3. Screens land **before** the wallet actions, so the actions have a surface to drive.

Rollback is reverting the change: the landing page and the unconsumed `/v1` client remain, and the added
routes simply disappear.

## Open Questions

- **Router library.** Recommend `react-router` v7 (library mode): three routes, a familiar API, minimal
  bundle. `@tanstack/react-router` is type-safer and pairs with the existing Query but is heavier to adopt
  here. Owner's call.
- **Offerings list scope.** One asset (SOLAR01) exists on the live chains, so the list is effectively a
  single featured card plus a chain switch; the "pipeline" cards in the reference do not exist on chain and
  are shown only if a `Pending`/`Approved` asset is actually returned by `/v1/assets?status=`.
- **`_1` vs `_2` for the detail screen.** Recommend `_2` (adds 24h volume) without the retired "auto-staking"
  copy, as plan F-6 proposes.
- **Where the chain switch lives.** Top nav vs a page-level control. Recommend top nav, since it governs the
  whole portal.
- **Owner sign-off on the redesigned copy.** Because WRONG elements are redesigned rather than cut, the new
  wording for the floor, yield, par and verification rows should be reviewed once against the built screens.
