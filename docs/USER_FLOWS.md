# ArcReserve User Flows

> Formal flows for the testnet demo (D-027). Every step names an actor, a gate, an artifact, and
> the onchain footprint. **Implemented** = exists in `contracts/` today; **target** = specified in
> `DECISIONS.md` and assigned in `docs/stacks/AGENT_CONTRACTS.md`. Institution-grade controls are
> demonstrated, not certified.

## 0. Principles

1. **Maker–checker for privileged actions.** No single key moves an asset between lifecycle states
   or moves reserve money in production; the demo runs one admin key per chain and labels it (D-027).
2. **Documents are hashed onchain, stored offchain.** Every submission, approval, report, and
   subscription references a hash; the UI shows the document and verifies the hash.
3. **Eligibility is enforced at transfer, not just at purchase** (D-021, implemented).
4. **Time-locks and cooling-off** protect against rushed approvals and rushed subscriptions (target).
5. **Everything is an event.** The indexer is the audit log; every flow below ends in an event.

## 1. Roles and keys

| Role | Demo (testnet) | Production path (documented, not deployed) |
| --- | --- | --- |
| Protocol admin | Deployer key (Anvil #0 / testnet deployer) | 3/5 multisig + 48 h timelock |
| Verifier (D-029) | ArcReserve-operated key, labelled "demo verifier" | Independent 2/3 multisig, ideally a third party |
| Issuer | Deployer key in the demo | Issuer's own multisig, KYB-bound |
| KYC provider (`REGISTRY_AGENT_ROLE`) | Deployer key | KYC vendor's signing key |
| Transfer agent (`TRANSFER_AGENT_ROLE`) | Protocol admin | Compliance officer key, never a hot keeper |
| Keeper (`KEEPER_ROLE`) | Deployer key | Hot key with only keeper rights, rotated |
| Trustee | Not represented onchain | Legal entity holding the lien; onchain only as the default-settlement trigger |

## 2. Issuer onboarding and asset registration

| Step | Actor | Gate | Artifact | Onchain | Status |
| --- | --- | --- | --- | --- | --- |
| 2.1 KYB | Issuer → compliance | Company registration, UBO, sanctions | KYB file hash | `IssuerRegistered(issuer, kybHash)` | target |
| 2.2 Wallet binding | Issuer | Multisig for institutions; EOA allowed below a size threshold | Signed binding message | `ISSUER_ROLE` granted by admin | implemented (role) |
| 2.3 Asset draft + data room | Issuer | Name, category, jurisdiction, legal wrapper, capacity, PPA summary, cash-flow history, valuation, insurance, permits | Data room | none | offchain |
| 2.4 Term sheet | Issuer + counsel | Cap, offering size, price, maturity, 65/30/5 split, reserve schedule, contracted gross-revenue share, class caps | `DeploymentParams` (= the term sheet) | none until approval | D-026 |
| 2.5 Legal pack | Issuer counsel | Note agreement, security agreement (lien), trustee appointment, risk disclosures, subscription template | Pack hash | none | offchain |
| 2.6 Submit | Issuer | 2.3–2.5 complete | `metadataURI`, `metadataHash` | `submitAsset` → `AssetSubmitted`, status `Pending` | implemented |

## 3. Verification and approval

| Step | Actor | Gate | Artifact | Onchain | Status |
| --- | --- | --- | --- | --- | --- |
| 3.1 Intake | Verifier analyst | Completeness checklist | Checklist hash | none | offchain |
| 3.2 Due diligence | Verifier | Technical report, cash-flow model, valuation, legal opinion on lien enforceability | DD report hash, initial NAV, reserve schedule, revenue share | none | offchain |
| 3.3 Decision | Verifier (committee in production) | Approve / request changes / reject with reason | Decision memo hash | `approveAsset(assetId, initialNAV, termsHash)` → `NAVUpdated`, `AssetStatusChanged(Pending→Approved)`, `TermsApproved`; or `rejectAsset` | approve implemented; `termsHash` and reason are D-026 target |
| 3.4 Time-lock | — | 48–72 h public window; issuer may withdraw | — | deployment blocked until `approvedAt + delay` | target |
| 3.5a Deployment — phase 1 | Issuer | `keccak256(abi.encode(params)) == termsHash`; approved pool factory; non-zero identity registry | — | `beginAssetSystem` → `AssetSystemBegun`; token/vault/offering/revenue deployed and wired; asset **stays Approved** and inert (vault refuses deposits with `SystemNotActive()`) | implemented (D-033) |
| 3.5b Deployment — phase 2 | Same wallet as phase 1 | phase-1 record exists; caller is the phase-1 initiator; `params.assetId == assetId`; hash matches the one phase 1 recorded | — | `completeAssetSystem` → `AssetSystemDeployed`, `AssetContractsSet`, `Active`; redemption/pool/market manager deployed; token bound to registry; pool + market manager exempt; factory renounces every role | implemented (D-033) |
| 3.5c Deployment — abandon | Phase-1 caller **or** factory admin | a phase-1 record exists | — | `abandonAssetSystem` → `AssetSystemAbandoned`; orphans left adminless; registry admin then `closeAsset` | implemented (D-033); no TTL by design |
| 3.6 Compliance binding | Protocol admin | `ModularCompliance.bindToken` then `token.setCompliance`; modules configured | — | `TokenBound`, `ModuleAdded`, `ComplianceAdded`, `CountryAllowed`, `HoldPeriodSet` | implemented |

## 4. Investor onboarding

| Step | Actor | Gate | Artifact | Onchain | Status |
| --- | --- | --- | --- | --- | --- |
| 4.1 KYC/AML | Investor → KYC provider | Identity, sanctions, PEP, source of funds above threshold | KYC reference (offchain) | none | offchain |
| 4.2 Classification | Compliance | Retail / accredited / institutional; jurisdiction | Class, country, expiry | `registerIdentity(wallet, onchainId, country, class, expiresAt)` → `IdentityRegistered`, `CountryUpdated`, `InvestorClassUpdated`, `ClaimExpiryUpdated` | implemented |
| 4.3 Wallet binding | Investor | Signed message; several wallets per identity allowed | — | one registry entry per wallet | implemented |
| 4.4 Suitability | Investor | Read and acknowledge disclosures; class limits shown | Acknowledgement hash | recorded at subscription (target) | target |
| 4.5 Renewal / revocation | KYC provider | Expiry reached or adverse finding | — | `updateClaimExpiry`, `deleteIdentity`; wallet loses transfer rights, keeps redemption | implemented |

Unverified wallets: cannot buy, receive, or sell into the pool (`RecipientNotVerified` /
`SenderNotVerified`). The UI must show verification status and the reason before the wallet tries.

## 5. Offering

### 5a. Current contracts (direct purchase)
Buy → `PrimaryOffering.buy(amount, minOut)`: window, `canIssue`, minimum, cap, wallet limit,
inventory, then mUSD → vault (70/20/10) and immediate mint to a **verified** buyer.
`TokensPurchased`, three `AllocationChanged`, `Transfer(0→buyer)`.

### 5b. Target (escrowed; D-007, D-008, D-023, D-028)

| Step | Actor | Gate | Onchain |
| --- | --- | --- | --- |
| Open | Auto at `startsAt` | Status Active; registry live | `OfferingOpened` |
| Subscribe | Investor | Verified; within class limit (retail 5,000 / accredited 50,000 / institutional uncapped); ≥ minimum; cap not exceeded; agreement hash signed | `Subscribed(investor, amount, agreementHash)`; mUSD in escrow; **no mint** |
| Cooling-off | Investor | Before close | `SubscriptionWithdrawn` |
| Close | Auto at `endsAt` or admin early-close at cap | — | `OfferingClosed(raised)` |
| Outcome | Contract | ≥100% full · >50% partial (issuer accepts within window) · ≤50% failed | `Settled` / `PartialAccepted` / `Failed` |
| Settlement | Anyone after outcome | Atomic: mint investor tokens; mint + exclude + flag issuer allocation; split **65/30/5**; start reserve schedule; `Active` | `AllocationChanged` ×3, `Transfer`, `ReserveScheduleSet`, `YieldExclusionChanged` |
| Refund | Investor | Failed or partial rejected | `Refunded` 1:1 |

## 6. Life of the asset

| Flow | Actor | Cadence | Gate | Onchain | Status |
| --- | --- | --- | --- | --- | --- |
| Revenue deposit | Issuer | Monthly | Contracted % of gross for the period; report hash | `depositRevenue(amount, periodId, reportHash)` → `RevenueDeposited`; 60/25/10/5 or 40/45/10/5 | split implemented; period tag + dynamic split target (D-022/23) |
| Sinking-fund contribution | Issuer | Quarterly | On schedule; grace 30 days | `depositReserve(amount, periodId)` → `ReserveContribution` | target |
| Shortfall | Contract | Continuous | backing < target past grace | `ReserveShortfallEntered/Cleared`; proceeds withdrawal + issuance blocked | target |
| Reserve yield | Yield source | Continuous | — | `accrueReserveYield` → reserve (behind) or issuer (on schedule) | target |
| Floor level-up | Anyone | Whenever backing covers next tick, ≤ 1 per cooldown | `min(NAV, backing) ≥ price(next tick)` | `FloorLevelUp(prevTick, newTick, price, backing, nav)` | target (D-025) |
| NAV update | Verifier | Quarterly / event-driven | ≤ 20% move; report hash | `publishNAV` → `NAVUpdated` | implemented (hash target) |
| Reporting | Issuer | Monthly ops, annual audited | Hash anchored | `ReportFiled(assetId, period, hash)` | target |
| Market making | Keeper | As needed | Safety gates; remove → update → remint; `rebalanceToFloor` under the level | `Rebalanced`, `PositionLiquidity*`, `FeesCollected` | implemented; `rebalanceToFloor` target |
| Proceeds withdrawal | Issuer | Any time | Not in shortfall; not suspended | `IssuerProceedsWithdrawn` | implemented; shortfall gate target |
| Freeze / forced transfer | Transfer agent | Legal order / recovery | Recipient verified | `AddressFrozen`, `TokensFrozen`, `ForcedTransfer` | implemented |

## 7. Investor post-settlement

| Flow | Gate | Onchain | Status |
| --- | --- | --- | --- |
| Claim revenue | Yield-eligible balance | `claimRevenue` → `RevenueClaimed` | implemented |
| Secondary transfer | Both legs verified (or exempt infrastructure); country allowed; resale hold elapsed | `Transfer` | implemented |
| Swap with the pool | Wallet verified; pool exempt | `Transfer` ↔ pool, `Swap` on a canonical pool | implemented (mock pool on Anvil/Hedera) |
| Normal redemption | Active; period limit; not issuer allocation; price `min(NAV, backing)` | `Redeemed`, `Transfer(→0)`, `RedemptionReleased` | implemented; issuer-allocation block target (D-024) |
| Maturity redemption | Matured; within window; up to `min(NAV, 1.0)` | same | implemented; window target |
| Emergency redemption | Suspended/Defaulted; settlement price | same | implemented |
| Statements | Monthly holdings + income | indexer `/v1/accounts/:address/assets/:assetId` | backend target |

## 8. Incident and exit paths

| Event | Trigger | Decider | Effect | Status |
| --- | --- | --- | --- | --- |
| Suspend | Missed report/deposit past grace; stale NAV; allegation | Verifier | Issuance + market paused; emergency redemption at last NAV | implemented |
| Reserve shortfall | Backing below schedule past grace | Contract | Proceeds + issuance frozen; verifier notified | target |
| Default | Shortfall > 90 days; legal default | Verifier (+ trustee notice) | Trustee enforces lien offchain; proceeds → reserve; `setEmergencySettlementPrice`; emergency redemption | implemented (status + price); shortfall trigger target |
| Resume | Cure confirmed | Verifier | Back to Active | implemented |
| Maturity → Close | Window elapsed | Admin (time-locked in production) | Issuer allocation burned; residual reserve → issuer; record archived | `markMatured` implemented; residual target |

## 9. Keeper / operations runbook (demo)

1. `levelUp()` after every reserve-crediting transaction (or on a 30-minute poll).
2. `safetyState(true)` before any rebalance; on `None`, remove → update → remint.
3. After `FloorLevelUp`, `rebalanceToFloor` to keep the market-floor range under the level.
4. Watch `ReserveShortfallEntered`, `AssetStatusChanged`, `AddressFrozen`, `ComplianceExemptionChanged`.

## 10. State machine (target superset of the implemented one)

```text
Draft ─► Pending ─► Approved ─(time-lock)─► Fundraising ─► Settled ─► Active ◄──► Suspended
                       │                        │                        │            │
                       └─► Closed (rejected)    └─► Failed → refunds     ├─► Defaulted ◄┘
                                                                         └─► Matured ─► Closed
Active sub-state: ReserveShortfall (entered/cleared by the schedule check)
```
Implemented today: `Pending → Approved → Active → Suspended ↔ Active → Defaulted / Matured → Closed`.
