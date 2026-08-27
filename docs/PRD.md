# ArcReserve Product Requirements

Status: current MVP requirements plus explicitly marked target requirements.

## 1. Product statement

ArcReserve turns verified real-world asset records into capped onchain participation markets with
stablecoin reserves, transparent value references, revenue distribution, and reserve-limited
redemption.

The demonstration asset is Solar Indonesia 01, a renewable-energy series with:

- 100,000 mUSD initial verified asset value;
- 100,000 SOLAR01 maximum supply;
- 1 mUSD initial NAV per token;
- 20,000 mUSD issuer-funded initial reserve;
- 20% minimum reserve ratio; and
- three-year maturity.

This MVP is infrastructure software. It does not establish legal title, guaranteed returns, a price
peg, or guaranteed 1:1 redemption.

## 2. Users and jobs

| User | Job |
| --- | --- |
| Issuer | Submit metadata, seed reserve, monitor offering, and deposit realized asset revenue |
| Verifier | Review evidence, approve/reject, publish NAV, suspend, resume, default, or mature an asset |
| Investor | Buy a capped participation token, compare value references, claim eligible revenue, and request redemption |
| Protocol admin | Configure roles and safety policy and coordinate emergencies |
| Keeper | Manage market inventory and ranges under oracle, reserve, cooldown, and slippage controls |
| Revenue depositor | Deposit verified/simulated operating revenue |
| Observer/indexer | Reconstruct asset, accounting, revenue, redemption, and market history from chain events |

## 3. Core product principles

1. Each series has a fixed authorized supply cap.
2. The market manager never receives mint authority.
3. Protected reserve and market allocation remain separate.
4. Spot, TWAP, NAV, protected floor, and redemption quote remain separate.
5. Redemptions reduce token obligations before reserve leaves.
6. Yield applies only to balances eligible at the time revenue is deposited.
7. Vested company tokens do not dilute active holder yield while excluded.
8. Target-only policies are visibly labeled in UI and docs.
9. Backend failures must not be hidden by plausible fixture data.
10. Product copy does not imply legal ownership or guarantees not established externally.

## 4. Current lifecycle

1. An authorized issuer submits identity, category, metadata URI/hash, and maturity.
2. A verifier approves with nonzero NAV or rejects the record.
3. The issuer deploys the asset system through the approved factory.
4. The factory wires roles, registers component addresses, and activates the series.
5. The issuer deposits the protected reserve.
6. Investors purchase directly from the active offering and receive tokens immediately.
7. A keeper funds/configures secondary-market positions from separate market inventory.
8. An authorized depositor submits asset revenue for the 60/25/10/5 split.
9. Eligible holders claim revenue.
10. Holders redeem under Normal, Maturity, or Emergency rules.
11. Verifier status or stale/unsafe data stops issuance and guarded market actions.

## 5. Target fundraising lifecycle

Target only:

1. Issuer defines fundraising target, authorized allocation, vesting, headroom, deadline, and success
   threshold.
2. Issuer deposits the required reserve before fundraising opens.
3. Investor subscriptions remain escrowed.
4. Settlement resolves to full success, partial success, or failure.
5. Successful settlement atomically delivers investor tokens, initializes company vesting, activates
   reserve, and releases accepted issuer proceeds.
6. Failed settlement refunds investors and returns issuer reserve according to disclosed rules.

See `BUSINESS_MODEL.md` for the exact proposed threshold and allocation policy.

## 6. Current economics

### Primary purchase

| Destination | Share |
| --- | ---: |
| Issuer proceeds | 70% |
| Protected reserve | 20% |
| Market allocation | 10% |

### Revenue deposit

| Destination | Share |
| --- | ---: |
| Yield-eligible holders | 60% |
| Protected reserve | 25% |
| Operator | 10% |
| Protocol fees | 5% |

SOLAR01 uses 18 decimals. mUSD, NAV, and token prices use 6 decimals.

## 7. Functional requirements

### Asset registry

- Generate collision-resistant asset IDs from chain, issuer, nonce, and metadata hash.
- Preserve issuer and immutable identifying submission fields.
- Limit verifier NAV movement and record timestamp.
- Expose staleness and issuance eligibility.
- Enforce valid lifecycle transitions.

### Token

- Enforce immutable maximum supply.
- Support ERC-20 Permit.
- Restrict mint and burn roles.
- Checkpoint revenue around every balance change.
- Permit only authorized redemption burns during token pause.

### Vault

- Track five categories independently.
- Reject category overdrafts.
- Require actual stablecoin backing for accounted values.
- Prevent market withdrawals when reserve minimum is violated.
- Prevent issuer access to reserve and market categories.

### Offering

- Enforce time, status, fundraising, wallet, inventory, and minimum-purchase limits.
- Respect buyer minimum token output.
- Move mUSD before accounting/mint completion.
- Emit exact split values.

### Revenue

- Reject deposits with zero eligible supply.
- Allocate revenue exactly across four destinations.
- Preserve earned revenue across transfer/exclusion changes.
- Prevent retroactive earnings for new or newly eligible balances.

### Redemption

- Enforce status-specific mode.
- Cap quote by liquid backing.
- Enforce holder minimum output and period limit.
- Burn before vault payout.
- Maintain supply/obligation equality.

### Market manager

- Authenticate pool callbacks and active payload.
- Enforce token direction, deadlines, min/max amounts, and roles.
- Gate actions on status, maturity, NAV freshness, oracle deviations, reserve solvency, and cooldown.
- Require zero active liquidity before range update.
- Keep protected reserve outside manager inventory.
- Allow authorized unwind during pause.

### Frontend

- Label live, derived, stale, mock, and target-only data.
- Use live contract terms for transaction previews.
- Preserve separate value references and safety disclosure.
- Show submitted, confirmed, and indexed transaction states.
- Provide accessible chart/value alternatives.

### Backend/indexer (target next milestone)

- Index events idempotently.
- Detect and roll back reorged blocks.
- Store exact base units and decimal strings.
- Expose asset, accounting, activity, position, and candle APIs.
- Derive OHLC from canonical swaps for both token orderings.
- Publish indexed block, timestamp, provenance, and stale state.

## 8. Implementation status

| Requirement | Status | Boundary |
| --- | --- | --- |
| Registry and verifier lifecycle | Implemented | Role-controlled mock verification model |
| Capped per-series token | Implemented | Immutable maximum supply |
| Category-accounted vault | Implemented | Five categories and solvency checks |
| Direct primary purchase | Implemented | Immediate 70/20/10 accounting and mint |
| Escrowed threshold fundraising | Target only | Specification and UI preview |
| Company vesting | Partial | Contract, exclusion, local script, tests; no generic settlement wiring |
| Circulating-only holder revenue | Implemented | Transfer hook and exclusion accounting |
| Reserve-limited redemption | Implemented | Three modes and period cap |
| Guarded range manager | Implemented | Mock pool integration and strong tests |
| Production AMM | Not implemented | Deterministic harness only |
| Backend/indexer/OHLC | Not implemented | Detailed design exists |
| Frontend | Prototype | Selected live writes, mostly fixture reads |
| Lock and earn | Target only | No lock/reward contracts |
| Governed headroom issuance | Target only | Cap exists; policy controller does not |

## 9. MVP acceptance criteria

- Complete local submit, approve, deploy, reserve, purchase, revenue, claim, redeem, rebalance, mature,
  and default flows can be demonstrated.
- No issuance path exceeds 100,000 SOLAR01.
- Issuer cannot withdraw protected reserve or market allocation.
- New buyers cannot claim earlier holder revenue.
- Yield-excluded vesting balances neither dilute nor claim while excluded.
- Market callbacks require the configured pool and active manager operation.
- Stale NAV, excess deviation, insolvent reserve, inactive status, or maturity stops guarded market
  actions.
- Unit, integration, fuzz, and stateful invariant tests pass.
- UI clearly labels current versus target behavior.

## 10. Data and UX acceptance criteria

- Every market metric identifies source and freshness.
- Failed live reads never silently become fixture values.
- Buy preview uses immutable offering price; redemption preview uses live mode quote.
- OHLC comes from canonical indexed swaps or is visibly labeled synthetic.
- Target settlement, headroom, and locking remain marked until contracts enforce them.
- Market price, TWAP, NAV, floor, reserve, and redemption are never collapsed into one number.

## 11. Backend acceptance criteria

- Unique raw log identity is `(chainId, transactionHash, logIndex)`.
- Cursor includes block number and hash.
- Restart and duplicate-range processing are idempotent.
- Reorg recovery finds common ancestor and rebuilds affected projections/candles.
- Financial values avoid JavaScript floating point.
- Fresh database replay produces the same deterministic read model.

## 12. Out of scope for the hackathon MVP

- Legal structuring and enforceable asset rights.
- Custody and bankruptcy-remoteness implementation.
- KYC/AML, sanctions, accreditation, and jurisdiction rules.
- Fiat onboarding and production stablecoin selection.
- Production NAV oracle network.
- Audited canonical AMM strategy and autonomous keeper.
- Mainnet deployment, monitoring, incident response, and governance timelocks.

