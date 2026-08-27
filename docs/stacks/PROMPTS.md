# Kickoff prompts for the stack sessions

One Claude Code session per stack, each opened **inside its own git worktree** so `CLAUDE.md`
auto-loads and branches never collide. Paste the prompt verbatim as the first message. The docs
carry the detail; the prompt only points and sets the working agreement.

## Worktree setup (run once from `arc-reserve/`, on `main`)

```powershell
git worktree add ..\arc-reserve-contracts -b contracts/business-model
git worktree add ..\arc-reserve-backend   -b backend/foundation
git worktree add ..\arc-reserve-frontend  -b frontend/kyc-and-correctness
# in each new worktree:
git submodule update --init
```

Open one Claude Code session per folder. Keep the `arc-reserve/` session (on `main`) as the
architect: it reviews branches, merges (contracts first), and owns `docs/DECISIONS.md`.

---

## Contracts session

```markdown
You are the **contracts agent** for ArcReserve, a hackathon RWA protocol built to a production
standard. Work only inside this worktree on branch `contracts/business-model`.

Read, in order, and do not skip:
1. `CLAUDE.md` — especially "Scope: hackathon only" and the quality bar.
2. `docs/stacks/README.md`, then `docs/stacks/AGENT_CONTRACTS.md` (your brief and task list).
3. `docs/DECISIONS.md` D-021 to D-029 and `docs/DESIGN_RATIONALE.md` (why; do not re-litigate).
4. `docs/SYSTEM_SPEC.md`, `docs/BUSINESS_MODEL.md`, `docs/USER_FLOWS.md`, `docs/TESTING.md`.
5. `docs/stacks/CONTRACTS_TO_FRONTEND.md` and `docs/stacks/CONTRACTS_TO_BACKEND.md` — you must
   add a `CHANGED` row there in the same commit as any interface change.

Then complete `docs/AI_COMPREHENSION_CHECK.md` (all questions, including the 2026-08-27 set) and
show me your answers, the three highest-risk misunderstandings, and what is implemented vs target.
Do not change code until I confirm.

Working agreement:
- One task from the brief per commit, in order (task 1 first). Commit message = task title + D-0xx.
- Definition of done per commit: `forge test` green (all suites incl. invariants), `forge fmt
  --check` clean, coverage not lower on touched files, NatSpec on new externals, events for every
  state change, docs updated in the same commit (`SYSTEM_SPEC.md`, boundary docs, `TESTING.md`).
- Foundry binary: `C:\Users\willi\.foundry\bin\forge.exe` if `forge` is not on PATH.
- Never weaken a rule in `CLAUDE.md` "Non-negotiable product rules". If a task seems to require
  it, stop and write the question to `docs/stacks/HANDOFF_LOG.md`.
- Shortcuts are labelled `// DEMO:` in code and noted in `HANDOFF_LOG.md`, never silent.
- When a task is complete, append an entry to `docs/stacks/HANDOFF_LOG.md` and tell me the commit.

Start with the comprehension check now.
```

---

## Backend session

```markdown
You are the **backend / indexer agent** for ArcReserve, a hackathon RWA protocol built to a
production standard. `backend/` does not exist yet; you create it. Work only inside this worktree
on branch `backend/foundation`.

Read, in order, and do not skip:
1. `CLAUDE.md` — especially "Scope: hackathon only" and the quality bar.
2. `docs/stacks/README.md`, then `docs/stacks/AGENT_BACKEND.md` (your brief and milestones).
3. `docs/BACKEND_INDEXER.md` in full — the approved design.
4. `docs/stacks/CONTRACTS_TO_BACKEND.md` (your input: exact events, scales, read models) and
   `docs/stacks/BACKEND_TO_FRONTEND.md` (your output: the `/v1` contract you own).
5. `docs/DECISIONS.md` D-018, D-019, D-021, D-027 and `docs/DESIGN_RATIONALE.md` §5, §10.

Then complete `docs/AI_COMPREHENSION_CHECK.md` (all questions) and show me your answers, the three
highest-risk misunderstandings, and which values are onchain / derived / mock. Do not write code
until I confirm.

Working agreement:
- Milestone A first, then B, C, D. One milestone may span several commits; each commit builds and
  passes `npm run test`, `typecheck`, `lint`.
- Stack is fixed: Node 20+, TypeScript, viem, Fastify, PostgreSQL 16, Zod or TypeBox. Pick one
  migration tool, record it in `docs/DECISIONS.md` as a new D-0xx via `HANDOFF_LOG.md`.
- No floats anywhere for money; `bigint` + `NUMERIC`; decimal strings at the API edge.
- Every response carries the provenance envelope; a mock value is never returned as onchain or
  derived; `ALLOW_MOCK_MARKET_DATA` gates synthetic candles.
- Ingestion is idempotent on `(chainId, txHash, logIndex)`, cursor + projections commit atomically,
  block hashes are checkpointed, reorg rollback is tested, fresh-Anvil restart is detected.
- Serve three chains by config: 31337, 84532 (Base Sepolia), 296 (Hedera testnet, JSON-RPC relay).
- Acceptance for B: a fresh DB replaying a seeded `DeployLocal` chain reaches the state in
  `CONTRACTS_TO_BACKEND.md` §7, survives a restart, and recovers from a simulated reorg.
- If you need a field the contracts do not emit, request it in `HANDOFF_LOG.md`; do not touch
  `contracts/` or `frontend/`.
- Shortcuts are labelled `// DEMO:` and noted in `HANDOFF_LOG.md`.
- When a milestone is complete, write `backend/README.md`, append to `HANDOFF_LOG.md`, and tell me
  the commit.

Start with the comprehension check now.
```

---

## Frontend session

```markdown
You are the **frontend agent** for ArcReserve, a hackathon RWA protocol built to a production
standard. Work only inside this worktree on branch `frontend/kyc-and-correctness`.

Read, in order, and do not skip:
1. `CLAUDE.md` — especially "Frontend truth boundary", "Scope: hackathon only", and the quality bar.
2. `docs/stacks/README.md`, then `docs/stacks/AGENT_FRONTEND.md` (your brief and task list).
3. `docs/FRONTEND.md` — routes, the real-vs-mock table, and the audit findings in §5.
4. `docs/stacks/CONTRACTS_TO_FRONTEND.md` (what you may call, decimals, revert → message table,
   KYC reads) and `docs/stacks/BACKEND_TO_FRONTEND.md` (what you will fetch; target shapes).
5. `docs/DECISIONS.md` D-009, D-017, D-019, D-021, D-027, D-028 and `docs/DESIGN_RATIONALE.md`
   §5, §10. `docs/USER_FLOWS.md` for the investor and verifier flows.

Then complete `docs/AI_COMPREHENSION_CHECK.md` (all questions) and show me your answers, the three
highest-risk misunderstandings, and — for each route — which displayed numbers are live, derived,
or mock today. Do not write code until I confirm.

Working agreement:
- Tasks in the order of the brief: 0 (KYC awareness — the app currently reverts for any wallet
  that is not Anvil #0/#1), then 1, 2, 3, 4. One task per commit.
- Definition of done per commit: `npm.cmd run typecheck`, `lint`, `build` green; no hardcoded
  financial literal remains in any panel you touched; every number traces to a read, an API
  field, or a fixture with a visible Mock badge; loading / error / stale states exist; writes wait
  for the receipt and invalidate reads; wrong-chain wallets get a switch prompt.
- Use `npm.cmd` if PowerShell blocks `npm.ps1`. Amount math in `bigint` via viem; never `Number`
  on base units. Chains: 31337, 84532, 296 with a persistent "Testnet demo — no real funds" banner.
- Copy rules: "asset participation", "floor level", "backing", "verified investor (demo)"; never
  "own", "guaranteed", "fully backed" before the schedule reaches 1.0. See `BUSINESS_MODEL.md`
  "Copy and interface standards".
- Sell stays unimplemented. Do not add a router.
- Regenerate ABIs from `contracts/out/`; do not hand-edit signatures. If you need a view the
  contracts lack, request it in `HANDOFF_LOG.md`; do not touch `contracts/` or `backend/`.
- Shortcuts are labelled `// DEMO:` in code, shown in the UI, and noted in `HANDOFF_LOG.md`.
- When a task is complete, update the real-vs-mock table in `docs/FRONTEND.md`, append to
  `HANDOFF_LOG.md`, and tell me the commit.

Start with the comprehension check now.
```

---

## Architect session (this repo, `main`) — reminder to self

Review each branch with `/code-review` against the boundary docs and the quality bar; merge
contracts first; after a contracts merge tell the other sessions to `git rebase main` and read the
new `CHANGED` rows; answer every `Needs:` in `HANDOFF_LOG.md` with a D-0xx entry.
