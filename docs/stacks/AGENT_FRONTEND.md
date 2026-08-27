# Agent brief — Frontend (Next.js 15, React 19, wagmi 2, viem 2, Recharts 3)

You own `frontend/`. Read `CLAUDE.md`, then `docs/FRONTEND.md`,
`docs/stacks/CONTRACTS_TO_FRONTEND.md` (what you may call), and
`docs/stacks/BACKEND_TO_FRONTEND.md` (what you will fetch).

## You own
- `frontend/**`, including `src/lib/contracts.ts`, `src/lib/data.ts`, `src/lib/wagmi.ts`
- The fixture → live migration and all provenance labeling

## You do not touch
- `contracts/**`, `backend/**`. Missing view/field → request in the boundary doc.

## Scope (D-027)
Hackathon only. wagmi `chains: [anvil, baseSepolia, hederaTestnet]` with per-chain address maps
(from `contracts/deployments/<chainId>.json`), a chain-switch prompt, and a persistent
**"Testnet demo — no real funds"** banner on every route. No copy may imply a live or regulated
offering; "verified", "compliant", and "protected" always carry the demo qualifier.

## Hard rules
- Never show a fixture number where a live value was expected (D-019). No silent fallbacks.
- Every panel carries a `DataSourceBadge`: Live / Derived / Mock / Stale.
- Label target-policy panels (settlement preview, lock-and-earn) as previews, not as onchain.
- Sell stays unimplemented. Do not add a router.
- Amount math in `bigint` via `parseUnits`/`formatUnits`; never `Number` on base units.
- Verify wallet `chainId === 31337` before enabling writes; offer `switchChain`.
- Success = receipt confirmed (`useWaitForTransactionReceipt`), not hash submitted.

## Commands
```powershell
cd frontend
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run dev
```
All three checks must pass before hand-off. There is no test runner yet; adding Vitest + a few
component tests for formatting/state machines is welcome.

## First tasks (in order)
0. **KYC awareness** (the token is permissioned since 2026-08-27, D-021): add
   `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS`; show a Verified / Not verified / Expired badge from
   `IdentityRegistry.isVerified` + `claimExpiresAt`; before enabling Buy / Redeem call
   `AssetToken.transferRestriction(from, to, amount)` and render the mapped reason from
   `CONTRACTS_TO_FRONTEND.md` §5 when non-zero; connecting an unregistered wallet must explain why
   purchases are blocked rather than surfacing a raw revert.
1. **Correctness fixes** (no backend needed, all from `CONTRACTS_TO_FRONTEND.md` §6):
   - remove the `"142.80"` fallback; render loading / error / `0`;
   - buy preview from `tokenPrice()`, redeem preview from `redemptionPrice(0)`;
   - `submitAsset` reads the form inputs;
   - keeper ticks derived from `positions()`, `tickSpacing()`, `assetIsToken0()`, `meanTick`;
   - `safetyState(false)` drives the gates list;
   - receipt wait + query invalidation; chain guard; role-aware button enabling via `hasRole`.
2. **Direct-chain reads** replace hardcoded metrics on `/`, asset page, `/engine`, `/issuer`,
   `/verifier` using §4 of `CONTRACTS_TO_FRONTEND.md`. Move the inline `engineAbi` into
   `contracts.ts`; regenerate ABIs from `contracts/out`. Add `NEXT_PUBLIC_POOL_ADDRESS` and
   `NEXT_PUBLIC_COMPANY_VESTING_ADDRESS`. Add a script `scripts/sync-env.mjs` that writes
   `.env.local` from `contracts/deployments/31337.json`.
3. **Provenance layer**: `src/lib/api.ts` client with the envelope from `BACKEND_TO_FRONTEND.md`
   §1; a fixture adapter that wraps `data.ts` as `provenance: "mock"`; `DataSourceBadge`.
4. **Backend migration** route by route as the API lands (`BACKEND_TO_FRONTEND.md` §2), replacing
   `marketPipeline`, `priceHistory`, `liquidityPositions`, `rebalances`. Candle chart: timestamps
   from data, Y-domain from data, overlays from `/nav-history` + `metrics`, empty buckets rendered
   flat; wire the `1H/1D/1W/1M` buttons to `interval`.
5. Housekeeping: dynamic `assets/[slug]` route; nav label "Activity" → "Asset"; remove unused
   Tailwind or adopt it; delete `dev-server*.log` from the repo root; wagmi cookie storage for SSR.

## Definition of done for any change
typecheck + lint + build green; every displayed number is traceable to a read, an API field, or a
fixture with a visible Mock badge; no hardcoded price/reserve/supply literals remain in JSX for the
panel you touched.

## Hand-off artifact
Updated `docs/FRONTEND.md` "real versus mock" table, and any field requests added to
`BACKEND_TO_FRONTEND.md` or `CONTRACTS_TO_FRONTEND.md`.
