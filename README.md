# ArcReserve

**Real assets. Programmable liquidity.**

ArcReserve is a hackathon MVP for verified real-world asset participation markets. It combines
capped per-series tokens, stablecoin reserve support, NAV-aware concentrated liquidity, automated
revenue distribution, and reserve-limited redemption. The demonstration asset is **Solar Indonesia
01 (SOLAR01)**.

ArcReserve never treats NAV, market price, and redemption value as interchangeable. It does not by
itself promise legally enforceable ownership, returns, a price peg, or 1:1 redemption.

> **Hackathon project.** ArcReserve is built for a hackathon and is intended to be deployed only to
> **Base Sepolia** and **Hedera testnet** (plus local Anvil). It uses a mock stablecoin, test keys,
> and unaudited contracts. Nothing here is a regulated financial product, an offer of securities, or
> ready for real funds. The compliance, verification, and reserve mechanics are design
> demonstrations.

## Architecture

```text
Asset issuer ---> AssetRegistry <--- Verifier / NAV publisher
                       |
                       | approved record
                       v
        AssetFactory + approved component deployers
             |        |        |        |
             v        v        v        v
          SOLAR01   AssetVault  Offering  Revenue / Redemption
             |         ^                    |
             +---- ARC Liquidity Engine ----+---- Uniswap-compatible pool
                         |
                   spot + TWAP + NAV
```

The current contracts split primary purchases 70% to issuer proceeds, 20% to protected reserve, and
10% to market allocation. Deposited asset revenue splits 60% to yield-eligible circulating holders,
25% to reserve, 10% to operator accrual, and 5% to protocol fees.

The local demo creates a one-year company vesting wallet, excludes it from holder yield, and mints a
disclosed 20,000 SOLAR01 allocation to it. Generic factory settlement does not yet wire vesting. The
target commercial model additionally requires escrowed fundraising, partial settlement, governed
issuance headroom, floor accretion from realized value, and stablecoin-funded token-lock rewards.

## Documentation

Taking over this project? Start with [HANDOVER.md](HANDOVER.md) — current state, what remains,
and the onboarding gate.

For another coding agent, start with [CLAUDE.md](CLAUDE.md) and complete the
[AI comprehension check](docs/AI_COMPREHENSION_CHECK.md) before implementation.

| Document | Purpose |
| --- | --- |
| [System specification](docs/SYSTEM_SPEC.md) | Canonical current contract behavior and formulas |
| [Architecture](docs/ARCHITECTURE.md) | Components, trust boundaries, and flows |
| [Product requirements](docs/PRD.md) | Users, lifecycle, requirements, acceptance criteria |
| [Business model](docs/BUSINESS_MODEL.md) | Target fundraising, supply, utility, and revenue model |
| [Decision log](docs/DECISIONS.md) | Accepted decisions and unresolved owner choices |
| [Market making](docs/MARKET_MAKING.md) | ARC positions, safety, Hikari mapping, tests |
| [Backend/indexer](docs/BACKEND_INDEXER.md) | Planned API, event ingestion, reorg, and OHLC design |
| [Frontend](docs/FRONTEND.md) | Routes, real versus mock behavior, integration plan |
| [Testing](docs/TESTING.md) | Suite map, coverage, commands, production test gaps |
| [Security](docs/SECURITY.md) | Threat model, emergency behavior, pre-production work |
| [Demo](docs/DEMO.md) | Local deployment and presentation runbook |
| [User flows](docs/USER_FLOWS.md) | Issuer, verifier, investor, keeper flows with gates, artifacts, and onchain footprint |
| [Design rationale](docs/DESIGN_RATIONALE.md) | Why each decision was made, alternatives rejected, verified vs assumed |
| [Stack boundaries](docs/stacks/README.md) | Contracts / backend / frontend interface docs, agent briefs, kickoff prompts, handoff log |

## Prerequisites

- Foundry (`forge`, `anvil`, and `cast`)
- Node.js 20 or newer and npm

Dependencies are present under `contracts/lib` in this workspace. For a clean checkout, install
compatible OpenZeppelin Contracts 5.x and forge-std dependencies under that directory.

## Contracts

```powershell
cd contracts
forge build
forge test
```

On this Windows machine, Foundry is also available directly at:

```powershell
C:\Users\willi\.foundry\bin\forge.exe test
```

Start a local chain and deploy the seeded demo:

```powershell
anvil
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal `
  --rpc-url http://127.0.0.1:8545 --broadcast
```

The script creates mUSD, registry, identity registry (KYC), component deployers, factory, SOLAR01,
vault, offering, revenue distributor, redemption controller, callback-harness pool, ARC engine,
modular compliance with country and resale-lock modules, and yield-excluded company vesting wallet.
Only Anvil accounts #0 and #1 are registered as verified wallets; any other address is blocked from
holding SOLAR01 (override the investor with `DEMO_INVESTOR=0x...`). It configures the market ranges and deposits a 20,000 mUSD issuer reserve. Addresses
are written to `contracts/deployments/31337.json`.

Anvil addresses are ephemeral. Regenerate the deployment after every fresh chain restart.

## Frontend

React + Vite + TypeScript, Tailwind CSS v4, shadcn/ui, Vitest, Docker. Rebuilt from Next.js on
2026-09-12 (D-035).

```powershell
cd frontend
Copy-Item .env.example .env.local   # optional; without VITE_API_URL the app runs on fixtures
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev                         # http://localhost:3000
```

If PowerShell blocks `npm.ps1`, run the same scripts through `npm.cmd`, for example
`npm.cmd run build`. In a container: `docker compose build && docker compose up -d`.

Populate `.env.local` with the current deployment, using `VITE_`-prefixed names. Vite inlines them
at build time, so a change needs a dev-server restart and a Docker rebuild, and everything in that
file ships inside the browser bundle.

**Current state.** The backend `/v1` client, the fixture adapter, the provenance badge, and the
wagmi + react-query providers are ported and exercised by a landing page. The marketplace, asset,
issuer, verifier, and ARC Engine routes, both charts, and every wallet write existed before the
rebuild and are **not** ported yet. Sell execution is intentionally not implemented. See
[docs/FRONTEND.md](docs/FRONTEND.md) and D-035 in [docs/DECISIONS.md](docs/DECISIONS.md).

## Contract verification baseline

Last verified on 2026-08-27:

- 74 Foundry tests passed (18 cover the permissioned-transfer compliance layer);
- 0 failed and 0 skipped;
- 5 stateful financial invariants; and
- `AssetMarketManager` coverage of 98.17% lines, 95.50% statements, 73.91% branches, and
  100% functions.
- frontend TypeScript, ESLint, and the optimized production build all passed. (The frontend was
  rebuilt on React + Vite on 2026-09-12, D-035; its current baseline is 25 Vitest tests plus
  typecheck, lint, and build — see `docs/TESTING.md` §11.)

Coverage is not an audit. The local pool is a deterministic callback/oracle harness, not a
production AMM or an economic simulation.

## Current limitations

- No backend, indexer, database, or live OHLC service exists yet.
- The current offering is direct purchase/mint, not escrowed threshold settlement.
- Generic factory settlement does not yet create the company vesting allocation.
- The market update lifecycle requires explicit remove, update, and remint transactions.
- The mock pool does not model tick crossing, fees, price impact, MEV, or liquidity exhaustion.
- Production NAV/oracle infrastructure, legal rights, custody, KYC/AML, fiat rails, governance
  delays, monitoring, and mainnet deployment remain out of scope.

Review [docs/SECURITY.md](docs/SECURITY.md) before extending the MVP.
