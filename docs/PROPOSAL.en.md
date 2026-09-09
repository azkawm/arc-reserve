# ArcReserve — Business Proposal & System Architecture

> Prepared 2026-09-09 from the current state of `main`. This document summarizes `HANDOVER.md`,
> `CLAUDE.md`, `docs/BUSINESS_MODEL.md`, and `docs/ARCHITECTURE.md` into a single brief suitable
> for a hackathon submission, a pitch, or fast onboarding. For full technical detail, the source
> documents remain authoritative — this file is a summary, not a replacement.

## 1. Executive summary

**ArcReserve** is a protocol that turns cash flow from a real-world asset (RWA) — a solar power
project or a rental property, for instance — into a digital token that KYC-verified investors can
buy, trade, and claim yield from. The demonstration series is **Solar Indonesia 01 (SOLAR01)**.

Product tagline: **"Real assets. Programmable liquidity."**

The core model is simple: an issuer (asset owner) sells a token representing a **claim on cash
flow** (not ownership of the underlying asset), investors receive **60% of the asset's gross
revenue** on a recurring basis, and investors can **exit (redeem) at any time** against a protected
stablecoin reserve held onchain. The issuer must refill that reserve to par (1:1 per token) by
maturity, on a published schedule that is enforced onchain and cannot be quietly changed.

**Current status: hackathon MVP, production-grade quality bar.** Everything runs on testnets
(Anvil, Base Sepolia, Hedera testnet) with a mock stablecoin — no real funds, no real investors, no
audit yet. But the code standard, test coverage, and architectural discipline are built to match a
production system, not a throwaway demo.

## 2. The business problem

### From the asset owner's (issuer's) side

Small-to-mid-scale productive asset owners (renewable energy projects, rental properties, and
similar) in emerging markets often struggle to access capital because:

- **Traditional financing is slow and expensive** — it requires institutional intermediaries, high
  legal costs, and large minimum tickets that exclude smaller investors
- **There is no easy, transparent, auditable way to share cash-flow ownership** across many small
  investors
- **Investor trust is low** without a clear, verifiable guarantee mechanism

### From the investor's side

- **Traditional RWA investment is illiquid** — once money goes into a physical property or project,
  exiting before maturity is hard
- **No real-time transparency** into the financial health of the asset they funded (is the reserve
  sufficient, is the issuer late on reporting, and so on)
- **Hard to distinguish an honest, bounded cash-flow claim from a "guaranteed return" token** (often
  a scam pattern)

### What ArcReserve addresses

| Problem | ArcReserve's answer |
| --- | --- |
| Small investors can't access RWA | Tokens are fractionalized, low minimum purchase, permissioned but open to a retail investor class |
| Illiquidity | Exit any time to an onchain reserve at `min(NAV, backing)`, plus secondary trading on a DEX |
| Lack of transparency | Every movement of funds (issuer proceeds, reserve, market allocation, revenue) is a separate accounting category recorded as an onchain event |
| Issuer default risk hidden from investors | Reserve shortfall is detected automatically and **surfaced onchain**, not negotiated privately — floor price pauses its climb while backing is unhealthy |
| "Tokens with fake guaranteed returns" | The design explicitly avoids that claim: this is a capped cash-flow claim, not equity, not a peg, not a guaranteed dividend — labeled honestly throughout the product copy |

## 3. Product solution — how it works, briefly

Each asset series (e.g. SOLAR01) consists of:

1. A **capped-supply ERC-20 token** that is **permissioned** — only KYC-verified wallets may
   hold/transfer it
2. A **vault with five separate accounting categories** — issuer proceeds, protected reserve,
   market-making allocation, asset revenue, and protocol fees — never commingled
3. An **offering** for the initial token sale to investors
4. A **revenue distributor** that splits periodic income to token holders proportionally
5. A **redemption** path letting investors exit at any time against the reserve
6. An **ARC Liquidity Engine** — an onchain market maker built on Uniswap V3-style concentrated
   liquidity, with guard rails that prevent it from minting its own inventory
7. **Four human roles**: issuer, verifier (due diligence & NAV), investor, and keeper (liquidity
   operator)

The flow in short: **issuer lists → verifier approves → investors subscribe → issuer deposits
revenue periodically → the reserve fills in stages → the price floor rises in stages → investors
can redeem any time or trade on the DEX → at maturity, the reserve must be fully backed 1:1 per
token.**

## 4. Business model

### Stakeholders and their roles

| Role | Responsibility |
| --- | --- |
| **Issuer** | Submits the asset + legal pack, sets the term sheet, reports gross revenue periodically, deposits the contracted revenue share, meets the reserve schedule |
| **Verifier** | Due diligence, approves/rejects the term sheet, publishes & updates NAV, can suspend/default the asset |
| **Investor** | Passes KYC, subscribes with stablecoin, receives tokens, claims revenue, redeems or trades |
| **KYC provider** | Maintains the protocol's identity registry |
| **Keeper** | Operates the ARC engine's liquidity (repositions ranges, rebalances) |
| **ArcReserve (protocol)** | Protocol admin, transfer agent, collects the protocol fee |

### What each party gets (demo numbers, 100,000 mUSD raise at 1.00)

| | Issuer | Investor | Protocol |
| --- | --- | --- | --- |
| **At raise (65/30/5 settlement split)** | 65,000 mUSD cash upfront | Tokens backed at ~0.30/token initially | — |
| **Ongoing (60/25/10/5 revenue split when healthy, shifting to 40/45/10/5 when the reserve is behind schedule)** | 10% of every revenue deposit (operator fee) | 60% (or 40%) of every revenue deposit; floor price ratchets up over time | 5% of every revenue deposit |
| **At maturity** | Residual reserve returned once all obligations are met | Up to 1.00/token plus accumulated revenue | — |
| **Downside** | Proceeds withdrawal frozen if the reserve falls behind schedule; default triggers trustee enforcement of the lien | Principal is protected only up to what the reserve actually holds; capped by NAV | — |

### Protocol revenue model (ArcReserve itself)

- Asset onboarding fee
- Successful-raise fee on settled capital
- **5% of every revenue deposit** (already live in the contracts)
- A disclosed share of realized market-making fees
- Follow-on issuance fee

Hard rule: **protocol fees are never deducted from the protected reserve** — the reserve belongs
exclusively to investors.

## 5. Core economic mechanisms (summary)

| Mechanism | How it works, briefly |
| --- | --- |
| **Primary sale split** | 65% issuer (cash) / 30% reserve / 5% market allocation — already live in the contract (`ISSUER_BPS=6500`, `RESERVE_BPS=3000`, `MARKET_BPS=500`) |
| **Periodic revenue split** | 60% holders / 25% reserve / 10% operator / 5% protocol while the reserve is healthy; automatically shifts to 40/45/10/5 while the reserve is behind target — evaluated live on every deposit |
| **Reserve schedule (sinking fund)** | Backing rises linearly from ~0.30 → 1.00 mUSD/token over 3 years to maturity; a shortfall lasting more than 30 days blocks the issuer from withdrawing proceeds |
| **Published floor** | An onchain, ratchet-only price floor, bounded by `min(NAV, backing)`, advancing one step per call to `levelUp()` (permissionless — anyone may call it), with a 30-minute cooldown |
| **Market-making (ARC Engine)** | Uniswap V3-style concentrated liquidity funded only from the 5% market allocation — it never touches the reserve and cannot mint its own token inventory |
| **Redemption** | Available any time while the asset is active, priced at `min(NAV, reserve ÷ investor supply)`, subject to a daily limit; tokens are burned before funds leave the vault |

Five distinct price references (market spot, TWAP, verified NAV, floor level, redemption price) are
**deliberately kept separate** throughout the system — they are never collapsed into one
misleading number.

## 6. System architecture

### Component diagram

```text
                         +----------------------+
                         | Verifier / NAV role  |
                         +----------+-----------+
                                    |
                              NAV and status
                                    |
+--------------+          +---------v----------+          +----------------+
| Asset issuer |--------->|   AssetRegistry    |<---------| Indexer / API  |
+------+-------+ submit   +---------+----------+  events  +--------+-------+
       |                            |                              |
       | deploy approved series     | component registry           | reads
       v                            v                              v
+------+-----------------------------------------------------------+------+
|                          AssetFactory                                   |
| token deployer | vault | offering | revenue | redemption | market       |
+------+-------------+-------------+-------------+------------------------+
       |             |             |             |
       v             v             v             v
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
| AssetToken | | AssetVault | | Offering  | | Revenue / Redemption      |
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
       |             ^             |             |
       |             | stablecoin  |             |
       +-------> AssetMarketManager <-------------+
                         |
                  authenticated callbacks
                         |
                         v
                +--------+---------+
                | V3-compatible    |
                | asset/mUSD pool  |
                +------------------+
```

### System layers (3 stacks)

| Layer | Function | Technology |
| --- | --- | --- |
| **Contracts** (`contracts/`) | All financial logic, accounting, compliance, redemption, market-making | Solidity (Foundry), ERC-3643-shaped compliance |
| **Backend** (`backend/`) | Onchain event indexer + a `/v1` read API with provenance labels (`onchain`/`derived`/`mock`) | Node.js, PostgreSQL, node-pg-migrate |
| **Frontend** (`frontend/`) | Marketplace, asset pages, issuer/verifier/keeper panels, wallet transactions | Next.js |

### Key architectural principles

- **One isolated system per asset series** — SOLAR01 and any future series never share storage
- **Registry as the component directory** — every official contract address is discovered through
  the registry, never taken as arbitrary user input
- **Category accounting, not one shared treasury** — the vault's five fund categories never mix
- **Issuance is separated from market-making** — only the offering may mint; the market manager can
  never mint its own token inventory
- **Independent value references** — NAV (verifier), spot/TWAP (pool), floor & redemption (reserve)
  are compared against each other, never collapsed into one
- **Observable, recoverable market operations** — the keeper's range-management lifecycle is
  explicit: remove old position → verify safety → update range → remint

### Trust boundaries

| Party | Trusted to | Cannot do |
| --- | --- | --- |
| Verifier | Evaluate evidence, publish honest NAV/status decisions | — |
| Protocol admin | Manage roles, exclusions, pause state, safety policy (single key in the demo) | — |
| Keeper | Choose ranges, withdraw market allocation, add/remove liquidity | Mint through the manager, debit the protected reserve |
| Issuer | Submit its asset, seed reserve/revenue, withdraw only its own categorized proceeds | Directly debit the protected reserve |
| Frontend/backend | Read & display data, sign only through the user's wallet | Bypass contract roles; the backend holds no signing keys |

## 7. Implementation status — done vs. not done

### ✅ Implemented and tested

**Contracts** (247 tests passing, 20 suites including invariants):
- Capped-supply ERC-20 token with full permissioned compliance (identity registry, modular
  compliance, freeze, forced transfer)
- Vault with 5 separated accounting categories plus automatic solvency checks
- Direct-purchase offering (immediate mint) with investor-class limits, raise cap, per-wallet cap
- 65/30/5 primary-sale split (issuer/reserve/market)
- Revenue distributor with dynamic 60/25/10/5 ↔ 40/45/10/5 split, per-token accumulator,
  yield-exclusion for vesting balances
- Reserve-limited redemption (`min(NAV, backing)`), burn-before-pay ordering
- Reserve-yield hook, sinking-fund schedule with shortfall enforcement
- Residual return plus a 90-day maturity window
- `FloorController` — ratchet-only published floor, one tick per `levelUp()`, 30-minute cooldown
- ARC Liquidity Engine (`AssetMarketManager`) — 4 Uniswap V3-style positions, slide/sweep/discovery
  operations, a safety layer (spot/TWAP deviation, cooldown, staleness checks)
- Term-sheet hash binding, full factory role renunciation
- Demo liquidity seeding, canonical `Swap` events emitted by the mock pool

**Backend**:
- Validated config that refuses non-testnet chains
- Database migrations (23 projection tables)
- Single-transaction-per-block event ingestion, restart-safe cursor, reorg rollback
- Full `/v1` read API with a provenance envelope, Zod-validated responses
- OHLC from canonical swaps plus an explicitly `mock`-labeled synthetic feed

**Frontend**:
- Marketplace and asset pages read live data from `/v1` with a per-panel provenance badge
- Clearly labeled fixture mode when the API isn't configured
- Live wallet writes: buy, claim, redeem, issuer actions, verifier actions, keeper range calls

**Documentation**: comprehensive and actively maintained (`DECISIONS.md` D-001–D-032,
`DESIGN_RATIONALE.md`, per-stack boundary docs, `AI_COMPREHENSION_CHECK.md`, `USER_FLOWS.md`)

### ⏳ Not yet implemented (specification/target only)

| Item | Effort | Notes |
| --- | --- | --- |
| **Escrowed fundraising** (full/partial/failed settlement + refunds) | Large | Today: direct purchase, immediate mint, no escrow — the largest remaining gap between the contracts and the business model |
| **Frontend: KYC gating** | Small, high value | An unverified wallet clicking Buy today gets a raw revert instead of an explanation |
| **Migrating issuer/verifier/engine frontend pages** off fixtures | Medium | Includes keeper ticks that are currently hardcoded |
| **Testnet deployments** (Base Sepolia & Hedera) | Medium | Two unknowns must be resolved first: the Base Sepolia Uniswap V3 factory address, and the Hedera EVM version |
| **Frontend test runner (Vitest)** | Small | Not set up yet |
| **Governed issuance headroom** (20,000 unminted tokens) | Large | The cap exists; the policy controller does not |
| **Lock-and-earn** | Large, lowest priority | UI preview and business rules only |
| **Factory-wired company vesting** | Removed from the product (D-031) | `CompanyVestingWallet` still exists as an unused primitive — the issuer is paid in cash, not tokens |
| **Canonical Uniswap V3 pool** (not a mock) | Medium-large | Currently tested against `MockUniswapV3Pool`, not the real pool — fork tests / a real deployment are needed |
| **Multisig/timelock governance** | Medium | Documented, not deployed — still a single admin key per chain |
| **Legal/custody/audit** | Out of hackathon scope | Would require a legal entity, licensing, a custodian, and an audit — deliberately not built |

## 8. Limitations & disclaimer (read before submission)

- **This is not a production-ready product.** Every "institution-grade" flow (KYC, maker-checker,
  term-sheet binding, reserve schedule) is a **design demonstration**, not certified compliance.
- **No security audit has been performed.** High test coverage is not a substitute for an audit.
- **The token is not equity, not legal title, not a guaranteed return, and not a price peg.** Any
  right it carries exists only to the extent the note agreement and security documents establish it
  — and within this hackathon's scope, those are still placeholders/hashes, not real legal
  documents.
- **The stablecoin used is a mock** (`MockUSD`) on every target chain — no real funds ever move.
- Every shortcut taken for hackathon speed is explicitly labeled in code (`// DEMO:`), in the UI,
  and in `docs/DECISIONS.md` — nothing is hidden.

## 9. Recommended next steps

1. **Frontend KYC gating** — small effort, large impact, closes the most visible security gap for
   judges and users alike
2. **Testnet deployments to Base Sepolia & Hedera** — unlocks genuine Uniswap Foundation and Hedera
   track integration, beyond local Anvil only
3. **Migrate the remaining frontend** (issuer/verifier/engine) off fixtures onto live data
4. **Escrowed fundraising** — the largest structural gap between the contracts and the documented
   business model
5. The rest: issuance headroom, lock-and-earn, multisig governance

---

*This document is a strategic summary for proposal/submission purposes. For definitive technical
detail, refer to `CLAUDE.md`, `docs/BUSINESS_MODEL.md`, `docs/ARCHITECTURE.md`, and the source code
in `contracts/src/` — passing Solidity tests remain the ultimate source of truth wherever this
document and the code disagree.*
