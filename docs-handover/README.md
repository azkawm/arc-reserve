# ArcReserve handover docs

Planning documents for building the owner's Stitch launchpad portal against the real contracts and
backend. Started 2026-09-13. Hackathon scope: testnets only (D-027). Live targets are **Hedera testnet
296** and **Circle Arc testnet 5042002**; Base Sepolia is parked.

These docs describe what exists and how to integrate with it. They do not replace
[`CLAUDE.md`](../CLAUDE.md), [`docs/DECISIONS.md`](../docs/DECISIONS.md) or the stack boundary docs in
[`docs/stacks/`](../docs/stacks/). When they disagree, the source-of-truth order in `CLAUDE.md` wins.

## Reading order

| # | Document | Owner | Answers |
|---|---|---|---|
| 1 | [`PRODUCT_KNOWLEDGE.md`](PRODUCT_KNOWLEDGE.md) | Contracts session (Contract Arch) | What every screen means on chain, and whether it is enforced |
| 2 | [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) | Backend session (arcreserve-9b) | Which API supplies each number, and the rules an integrator gets wrong |
| 3 | [`FRONTEND_INTEGRATION_PLAN.md`](FRONTEND_INTEGRATION_PLAN.md) | Backend session, with the wallet-writes section from Contract Arch | What to build, in what order, against what, and how to know it is done |

Read them in order. Each later document references the earlier ones instead of repeating them.

## Status vocabulary

Every screen element in these docs carries exactly one status. Never blur them — `CLAUDE.md` rule 10
requires UI previews to be labelled.

- **LIVE** — enforced on chain. Named contract, function and event.
- **DERIVED** — computed by the backend from chain data. Named endpoint and provenance.
- **NOT IMPLEMENTED** — a target or preview. Nothing enforces it; the UI must say so.

## Design sources

- **Product screens:** `design/stitch_arcreserve_rwa_launchpad_portal.zip` at the workspace root,
  outside this repo — 16 screens (`code.html` + `screen.png`) plus `literary_intelligence/DESIGN.md`.
- **Landing page:** `stitch-ui/` on `origin/main`, from the owner's `feat/frontend` pull request. A
  different design; not yet pulled into the local `main`.

## Working rules for these files

- One owner edits each file. Contributors send content to the owner by message; nobody co-edits,
  because the working tree is shared between sessions.
- Nothing here is committed until the owner has reviewed it.
