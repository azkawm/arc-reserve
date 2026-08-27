# Stack boundaries and agent assignment

> **Hackathon scope (D-027).** Testnet-only: Anvil `31337`, Base Sepolia `84532`, Hedera testnet
> `296`. Mock stablecoin, unaudited, no real funds. Every agent keeps that framing in code and copy.
> **Scope is limited; quality is not** — see the quality bar in `CLAUDE.md`. Shortcuts are
> labelled `// DEMO:` in code, in the UI, and in `DECISIONS.md`, never taken silently.

This folder is the **integration layer** of the documentation. The existing files in `docs/` describe
each subsystem from the inside. The files here describe what each stack *promises to the others*, so
that one agent per stack can work in parallel without re-reading the whole repository.

Read `CLAUDE.md` first. Source-of-truth order still applies: Solidity + passing tests beat
`SYSTEM_SPEC.md`, which beats everything else. Where a boundary doc here disagrees with a contract,
the contract wins and the boundary doc must be fixed.

## The three stacks

| Stack | Location | Status | Owner agent brief |
| --- | --- | --- | --- |
| Contracts | `contracts/` (Foundry, Solidity 0.8.24, OZ 5.x) | Implemented, 56 tests | [`AGENT_CONTRACTS.md`](AGENT_CONTRACTS.md) |
| Backend / indexer | `backend/` (**does not exist yet**; planned Node 20 + TypeScript + viem + Fastify + PostgreSQL) | Spec only | [`AGENT_BACKEND.md`](AGENT_BACKEND.md) |
| Frontend | `frontend/` (Next.js 15, React 19, wagmi 2, viem 2, Recharts 3) | Prototype; writes live, reads mostly fixtures | [`AGENT_FRONTEND.md`](AGENT_FRONTEND.md) |

## The three boundaries

```text
              (A) ABI + addresses + decimals
   contracts  ───────────────────────────────►  frontend   (wallet writes, execution-critical reads)
       │                                            ▲
       │ (B) events + ABI artifacts + addresses      │ (C) HTTP JSON, /v1, provenance envelope
       ▼                                            │
    backend/indexer  ───────────────────────────────┘        (history, aggregates, OHLC)
```

| Boundary | Document | What it fixes |
| --- | --- | --- |
| A. Contracts → Frontend | [`CONTRACTS_TO_FRONTEND.md`](CONTRACTS_TO_FRONTEND.md) | Exact function signatures the UI may call, decimals, roles per action, env-var → address mapping, revert → user message table, known couplings |
| B. Contracts → Backend | [`CONTRACTS_TO_BACKEND.md`](CONTRACTS_TO_BACKEND.md) | Exact event signatures to index, which events rebuild which read model, ordering/idempotency keys, ABI artifact location, address discovery, mock-pool limits |
| C. Backend → Frontend | [`BACKEND_TO_FRONTEND.md`](BACKEND_TO_FRONTEND.md) | `/v1` routes, response envelope, provenance + staleness semantics, number encoding, and the mapping from every `frontend/src/lib/data.ts` fixture to its replacement API shape |

External stack under evaluation: [`ATS_INTEGRATION.md`](ATS_INTEGRATION.md) — Hedera Asset
Tokenization Studio study, concept map, and integration options.

## Ownership matrix

| Concern | Owner | Others may |
| --- | --- | --- |
| Solidity source, tests, deploy script, `deployments/*.json` | Contracts agent | Read only |
| ABI strings in `frontend/src/lib/contracts.ts` | Frontend agent, **regenerated from `contracts/out/`** | Contracts agent must announce signature changes in `CONTRACTS_TO_FRONTEND.md` |
| Event catalog and projection rules | Backend agent | Contracts agent must announce new/changed events in `CONTRACTS_TO_BACKEND.md` |
| `/v1` API shapes | Backend agent | Frontend agent may request fields; changes go through `BACKEND_TO_FRONTEND.md` first |
| `frontend/src/lib/data.ts` fixtures | Frontend agent | Backend agent uses it as the *shape wishlist*, never as data |
| `docs/stacks/*` | Whoever changes the boundary | Update the doc **in the same change** as the code |

## Cross-stack change protocol

1. The stack that changes an interface edits the relevant boundary doc first (signature, event, or
   JSON shape), marks the row `CHANGED <date>`, and describes migration.
2. The consuming stack picks up the change from the doc, not by reading the other stack's source.
3. Nothing is "done" until both sides and the boundary doc agree. Definition of done in
   `CLAUDE.md` still applies (labels agree with implementation; provenance never lies).

## Shared conventions every agent must respect

| Convention | Value |
| --- | --- |
| Chains | Anvil `31337` (local), Base Sepolia `84532`, Hedera testnet `296` (JSON-RPC relay `https://testnet.hashio.io/api`) — never mainnet |
| Asset token (SOLAR01) amounts | 18 decimals |
| mUSD amounts, NAV, token prices, redemption price, spot, TWAP | 6 decimals (mUSD base units per **whole** token) |
| Basis points | `10_000 = 100%` |
| Revenue accumulator | internal `1e30` scaling, never exposed |
| Rounding | `Math.mulDiv`, round down |
| JSON financial numbers | **decimal strings**, never JS `number` |
| Provenance values | `onchain` / `derived` / `mock` — a mock value is never shown as anything else |
| Timestamps | Unix seconds (`uint64` onchain, integer in JSON) |
| Addresses | checksummed for display, lowercase for lookup keys |

## Discrepancies found while writing these docs (2026-08-27)

These are recorded so the owning agent can fix them; none were changed here.

- ~~`contracts/deployments/31337.json` lacked `companyVesting`~~ — regenerated 2026-08-27 by a
  `forge script` simulation; addresses match a fresh Anvil deploy from account #0 (deterministic
  nonces) and now include `identityRegistry`, `compliance`, and the two modules.
- `frontend/src/components/engine-controls.tsx` hardcodes ticks `[-276540, -275940]` for all three
  keeper calls; the deploy script seeds the anchor at `[-276600, -276000]` (asset is token0) and the
  ticks must be positive when it is not. (Frontend, see boundary A §6)
- `frontend/src/components/action-deck.tsx` falls back to the literal `"142.80"` when the live
  `claimableRevenue` read is undefined **or zero** — this violates decision D-019. (Frontend)
- `CLAUDE.md` says frontend source still contains mojibake; a byte scan of `frontend/src` found only
  valid UTF-8 punctuation. That pitfall is stale.
- `AssetFactory` retains `PAUSER_ROLE` on all six components and `KEEPER_ROLE` on the redemption
  controller and market manager after handoff (it only renounces `DEFAULT_ADMIN_ROLE`). Intentional
  or not, indexers and security docs should state it. (Contracts)
