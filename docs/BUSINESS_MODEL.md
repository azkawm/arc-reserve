# ArcReserve Business Model and Offering Flow

> Target v0.3 (2026-08-27). Supersedes v0.2. Aligned with decisions D-021 to D-026 in
> `DECISIONS.md`. "Implemented" below means it exists in `contracts/`; everything else is target
> policy that the contracts agent builds from `docs/stacks/AGENT_CONTRACTS.md`.
>
> **Hackathon scope (D-027).** This model describes how the product *would* work. The deliverable is
> a testnet demonstration on Base Sepolia and Hedera testnet with a mock stablecoin and no real
> investors. Legal, custody, licensing, and audit items are documented as requirements, not done.

## Product position

ArcReserve lets an issuer raise capital against a verified real-world asset by issuing a
**secured revenue-participation note** as a permissioned token. Investors fund the asset, receive a
contracted share of its gross revenue, can exit at any time against a protected stablecoin reserve,
and are repaid at maturity from a reserve that the issuer refills on a public schedule.

The token is **tokenization of a cash-flow claim**, not of the asset's title. It does not represent
equity, legal ownership, or a guaranteed return. Any right exists only where the note agreement and
security documents establish it (D-001).

## Core terminology

| Term | Meaning |
| --- | --- |
| Authorized supply | Hard maximum tokens for one series (`maximumSupply`, immutable) |
| Investor supply | Issued tokens not flagged as issuer allocation; the denominator for backing, redemption, and reserve ratio (D-024) |
| Issuer allocation | The company's disclosed vested tokens: yield-excluded while locked, **never redeemable** against the reserve, sellable to verified buyers after vesting |
| Issuance headroom | Authorized but unminted tokens, issuable later under governed rules |
| Backing | `protected reserve / investor supply`, in mUSD per token; non-decreasing while Active |
| Target backing | The scheduled backing at time *t*, linear from settlement backing to 1.00 at maturity |
| Floor level | The published protected-floor reference: a pool tick that steps up one tick spacing at a time, never above `min(NAV, backing)` (D-025) |
| Verified NAV | The verifier's current asset-value reference per token, with timestamp |
| Market price | Latest canonical-pool price; spot and TWAP are kept separate |
| Redemption price | `min(NAV, backing)`; what a holder actually receives per token today |

Five values stay separate everywhere: market spot, TWAP, verified NAV, floor level, redemption price
(D-009).

## Participants

| Participant | Responsibility |
| --- | --- |
| Issuer | Submits the asset and legal pack, defines the term sheet, reports gross revenue, deposits the contracted revenue share, meets the reserve schedule, operates the asset |
| Verifier | Reviews evidence and legal enforceability, approves the term sheet, publishes NAV, suspends or defaults |
| Investor | Passes KYC, subscribes with stablecoins, receives tokens, claims revenue, redeems or trades with verified counterparties |
| KYC provider | Maintains the protocol identity registry (`REGISTRY_AGENT_ROLE`) |
| Trustee (offchain) | Holds the security interest; enforces on default |
| ArcReserve | Protocol admin, keeper of the ARC liquidity engine, transfer agent, disclosures |

## Capital buckets

Kept separate in the vault and the interface (implemented for 3–7):

1. **Investor subscriptions** — escrow while the offering is open (target).
2. **Optional issuer deposit** — first-loss, returned last (target).
3. **Issuer proceeds** — settled capital the issuer may withdraw, unless in reserve shortfall.
4. **Protected reserve** — backs redemption and the floor level; only leaves through redemption or the residual release at closure.
5. **Market allocation** — inventory and stablecoins for the ARC engine only; never the reserve.
6. **Operator accrual** — the issuer's 10% of revenue deposits.
7. **Protocol fees** — ArcReserve's 5%; never presented as backing.

## Offering lifecycle

### 1. Onboarding and verification
Issuer KYB → asset draft and data room → legal pack (note agreement, security interest, trustee,
disclosures) → `submitAsset` with the pack hash → verifier due diligence → committee approval with
initial NAV, reserve schedule, and revenue share → time-locked window → deployment with parameters
that hash-match the approved term sheet (target; see `USER_FLOWS.md` when written).

### 2. Fundraising (target: escrowed)
Investors with a valid identity claim subscribe within class limits; funds sit in escrow; cooling-off
withdrawal allowed before close. Today's contracts mint immediately on purchase instead (D-007
pending).

### 3. Settlement (target)

| Outcome | Raise | Effect |
| --- | --- | --- |
| Full | ≥ 100% | Mint investor tokens; mint and lock issuer allocation; split proceeds; start the reserve schedule; `Active` |
| Partial | > 50% and < 100% | Same, with issuer acceptance step; unsold investor allocation stays unminted headroom (D-008) |
| Failed | ≤ 50% | Refund subscriptions 1:1; return issuer deposit; nothing minted |

**Settlement split (D-023): 65% issuer proceeds / 30% protected reserve / 5% market allocation.**
Backing at settlement is therefore ≈ 0.30 mUSD per investor token (plus any issuer deposit).
Current contracts use 70/20/10 per purchase until the escrow milestone lands.

## Economics of the note

### Revenue (D-022)
The term sheet fixes a **contracted percentage of gross asset revenue** (demo: 40%) that the issuer
deposits each reporting period with the period id and report hash. Gross revenue is externally
verifiable (e.g. kWh × tariff); profit is not. The deposit is split:

| Recipient | On schedule | Behind schedule |
| --- | --- | --- |
| Yield-eligible holders | 60% | 40% |
| Protected reserve | 25% | 45% |
| Operator (issuer) | 10% | 10% |
| Protocol | 5% | 5% |

Yield is paid per yield-eligible token (`investor supply − yield-excluded balances`); vesting tokens
earn nothing until released and nothing retroactively (D-005, D-006, implemented).

### The reserve schedule — a sinking fund (D-023)
```text
targetBacking(t) = backingAtSettlement + (1.00 − backingAtSettlement) × (t − t0) / (maturity − t0)
```
Reserve growth sources, all credited to the same bucket:

| Source | Status |
| --- | --- |
| 30% settlement holdback | target (20% today) |
| Scheduled issuer contributions (`depositReserve`) | target |
| 25–45% of revenue deposits | 25% implemented; dynamic split target |
| Reserve yield (to reserve while behind schedule, to issuer once on schedule) | target |
| Headroom issuance sold above par | target |
| Realised ARC surplus returned to the vault | target; never budgeted |
| Redemptions at `≤ backing` (raise backing for remaining holders) | implemented property |

**Enforcement.** Backing below `targetBacking(now)` beyond the grace period (demo: 30 days) puts the
series in *reserve shortfall*: issuer proceeds withdrawal and headroom issuance are blocked and the
verifier is notified; 90 days is a default trigger. Missing the schedule is visible onchain, not a
private covenant.

### Floor level-up (D-025)
The published floor is a pool tick. Whenever `min(NAV, backing)` covers the next tick, anyone may
call `levelUp()` and the floor rises by **one tick spacing** (demo: 60 ticks ≈ +0.6%), at most once
per cooldown (demo: 30 minutes). A large reserve inflow becomes a paced staircase, not a gap. The
ARC engine's market-floor range follows the level. The floor never moves down while Active and is
capped by NAV, so a NAV markdown pauses level-ups rather than publishing an unbacked floor.

This is how reserve growth becomes price: the market cannot stay below a redeemable floor for long,
because anyone can buy on the market and redeem against the reserve. The protocol never bids.

### Exit
- Any time (Active): redeem at `min(NAV, backing)`, subject to the daily period limit. Implemented.
- Maturity: redeem up to `min(NAV, 1.00)` during the maturity window. Window is target.
- Emergency (Suspended/Defaulted): redeem at the verifier's settlement price. Implemented.
- Residual reserve above outstanding obligations after the window → issuer at `Closed`. Target.

### What each party gets (demo numbers, 100,000 raise at 1.00)

| | Issuer | Investors |
| --- | --- | --- |
| Day 0 | 65,000 mUSD proceeds; 5,000 to market depth | Tokens backed 0.30, rising on schedule |
| Ongoing | Keeps 60% of gross revenue; 10% operator fee on deposits; reserve yield once on schedule | 60% (or 40%) of the deposited share; floor level-ups |
| Maturity | Residual reserve returned | Up to 1.00 per token + accumulated revenue |
| Downside | Proceeds frozen if behind schedule; default → trustee enforces the lien | Principal protected only to the extent of the reserve; NAV cap applies |

## Compliance (D-021, implemented)

The token is permissioned. Both legs of every transfer must pass the protocol `IdentityRegistry`
unless the counterparty is exempt infrastructure (the canonical pool, the market manager, the vesting
wallet). A verified wallet may trade with the pool; an unverified wallet can neither receive from it
nor sell into it. Per-token `ModularCompliance` adds jurisdiction allow-lists and a resale hold period.
A transfer agent can freeze balances and execute forced transfers to verified recipients. Burns
(redemption exits) are never blocked by an expired claim. The registry also serves Hedera ATS
securities as an external KYC list.

## Supply and secondary-market liquidity

Capped authorization with staged issuance is unchanged: only accepted investor tokens and the issuer
allocation are minted at settlement; the rest is headroom. When sellers disappear, liquidity is
introduced in this order: existing market inventory → vesting releases → governed headroom issuance
→ a new verified series. Headroom issuance requires an active, verified, solvent series; demand shown
by auction or multi-day TWAP; pre-announced price and allocation; and must not lower backing below
the floor level. Proceeds from issuance above par flow mainly to the reserve (illustrative: 0.80 of a
1.45 price) and count toward the next level-up.

Market **depth** comes from the 5% market allocation, LP fees, and the ARC engine. Market **value**
comes from backing, revenue yield, and scarcity. The two budgets never mix (rule 3 in `CLAUDE.md`).

## Lock-and-earn (target, unchanged)

Optional locking rewards long-term holders with realised stablecoin revenue or fees only, never with
new tokens; keeps a minimum free float (suggested 20%); locked tokens still count in backing.

## ArcReserve revenue model

Onboarding fee; successful-raise fee on settled capital; 5% of revenue deposits; a disclosed share
of realised market fees; follow-on issuance fee. Never deducted from the protected reserve.

## Copy and interface standards

| Use | Avoid implying |
| --- | --- |
| Asset participation token / revenue-participation note | Equity, title, ownership of the plant |
| Authorized capped supply | Unlimited supply |
| Floor level / protected floor reference | Guaranteed floor, peg, principal protection |
| Backing (reserve per investor token) | "Fully backed" before the schedule reaches 1.00 |
| Verified NAV | Market price or guaranteed exit value |
| Revenue distribution | Dividend (unless the legal instrument says so) |
| Floor level-up / accretion | Trading profit, dividend |
| Reserve-limited redemption | Always-on 1:1 redemption |
| Verified investor | "Anyone can buy" |

Every asset page shows separately: market spot, TWAP, verified NAV + timestamp, floor level, backing,
target backing and schedule status, redemption price and liquidity, investor supply, issuer
allocation, headroom, authorized supply, and the connected wallet's verification status.

## Lifecycle states

```text
Draft -> Verification -> Approved (time-lock) -> Fundraising
      -> Full / Partial (issuer accepts) / Failed (refund)
      -> Active (schedule running; level-ups; reserve shortfall as a sub-state)
      -> Suspended -> Active | Defaulted
      -> Matured (redemption window) -> Closed (residual to issuer)
```

## Current MVP versus target

| Area | Current contracts | Target (this document) |
| --- | --- | --- |
| Primary sale | Direct purchase, immediate mint, 70/20/10 | Escrow, thresholds, atomic settlement, 65/30/5 |
| Company tokens | Vesting wallet wired by the local script; yield-excluded; **redeemable** | Minted at settlement; yield-excluded; **non-redeemable**; excluded from backing denominator |
| Reserve | Grows via 20% of purchases + 25% of revenue; no schedule | Linear schedule to 1.00, issuer contributions, dynamic split, yield, shortfall enforcement |
| Floor | Continuous `min(NAV, reserve/supply)` reference | Same for redemption; published floor steps up one tick spacing per level-up |
| Revenue base | Any amount the depositor sends | Contracted % of gross, period-tagged, report hash |
| Residual reserve | Never leaves except via redemption | Returned to issuer at Closed |
| Compliance | **Implemented**: identity registry, modular compliance, freeze, forced transfer, exempt pool | — |
| Headroom issuance, lock-and-earn | Not implemented | Governed policy controllers |

## Decisions still required

1. Verifier: ArcReserve or independent party.
2. Investor classes in the MVP (retail vs accredited) and per-class limits.
3. ~~Term-sheet hash binding at deployment~~ — accepted (D-026).
4. Parameters: level-up cooldown, reporting and default grace periods, demo revenue share, step
   size (fixed at one tick spacing).
5. Reserve yield source (mock vs ERC-4626 stable).
6. Escrow details: exactly 50%, issuer rejection of partial, oversubscription, early close.
7. Follow-on issuance rules (TWAP window, auction, proceeds allocation).
8. Legal: rights, jurisdiction, custody, KYC/AML provider, tax, eligibility.

## Safety principles

- Investor principal is protected only by the reserve; the reserve leaves only through redemption
  or the documented residual release.
- The issuer's own tokens can never drain the reserve.
- Backing never decreases while Active; the floor level never moves down while Active.
- Market allocation and protected reserve never mix; the market manager never mints.
- Every deposit, contribution, level-up, redemption, freeze, and exemption is an onchain event.
- Mock, derived, and onchain values are labeled; a schedule shortfall is shown, never hidden.
- Only verified wallets hold the token; exemptions are for infrastructure, not people.
