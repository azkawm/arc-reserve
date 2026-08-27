# Agent brief — Backend / Indexer (Node 20, TypeScript, viem, Fastify, PostgreSQL)

You create `backend/`. It does not exist yet. Read `CLAUDE.md`, then `docs/BACKEND_INDEXER.md`
in full, then `docs/stacks/CONTRACTS_TO_BACKEND.md` (your input) and
`docs/stacks/BACKEND_TO_FRONTEND.md` (your output).

## You own
- `backend/**` (new workspace), `backend/abis/*.json` (copied from `contracts/out`)
- `docs/stacks/BACKEND_TO_FRONTEND.md` (API contract) and the DB schema in `docs/BACKEND_INDEXER.md`

## You do not touch
- `contracts/**`. If an event lacks a field you need, request it in `CONTRACTS_TO_BACKEND.md`.
- `frontend/**`. Shape changes go into `BACKEND_TO_FRONTEND.md` first.

## Fixed decisions
- Stack: TypeScript, viem, Fastify, PostgreSQL 16, Zod (or TypeBox) validation. Pick **one**
  migration tool and record it in `docs/DECISIONS.md` (open item 9).
- No floats anywhere in storage or arithmetic; `bigint` + `NUMERIC`.
- Provenance on every response: `onchain` / `derived` / `mock`. `mock` only when
  `ALLOW_MOCK_MARKET_DATA=true`.
- No user keys; no signing; read-only RPC.
- Idempotent ingestion keyed `(chainId, txHash, logIndex)`; cursor + projections commit atomically;
  block-hash checkpoints; reorg rollback.

## Config (env)
`NODE_ENV, PORT=4000, DATABASE_URL, CHAIN_ID=31337, RPC_HTTP_URL, RPC_WS_URL, START_BLOCK=0,
CONFIRMATIONS=0, POLL_INTERVAL_MS=1000, MAX_BLOCK_RANGE=2000, REGISTRY_ADDRESS, FACTORY_ADDRESS,
MUSD_ADDRESS, ALLOW_MOCK_MARKET_DATA=false`. Fail fast on invalid config; verify `eth_chainId`.

## Commands (to create)
```powershell
cd backend
npm install
npm run migrate
npm run dev          # api + indexer + candle worker in one process for the demo
npm run test         # unit + db integration + replay + reorg
npm run typecheck; npm run lint
```

## Milestones (from `docs/BACKEND_INDEXER.md` §17)
A. Workspace, config validation, migrations, `/v1/health`, chain identity check, `indexed_blocks` /
   `raw_logs` / `indexer_cursors` tables.
B. ArcReserve event ingestion per `CONTRACTS_TO_BACKEND.md` §2–3; restart-safe cursor; reorg rollback
   test; fresh-Anvil-restart detection.
C. Read API per `BACKEND_TO_FRONTEND.md` §2–3 with decimal strings and provenance envelope.
D. OHLC: synthetic adapter on Anvil (`source: "mock"`), canonical `Swap` ingestion behind a flag;
   aggregation for the six intervals; rebuild on rollback.
E. Support the frontend migration: keep the contract stable, add fields on request.

## Acceptance
A fresh DB replaying a seeded `DeployLocal` chain yields exactly the state in
`CONTRACTS_TO_BACKEND.md` §7; a restart resumes from the cursor; a simulated reorg rolls back and
re-projects with identical results; every `/v1` route validates against its Zod schema.

## Hand-off artifact
`backend/README.md` with run instructions, and any `CHANGED` rows in `BACKEND_TO_FRONTEND.md`.
