# Security Model

## Protected properties

- SOLAR01 supply cannot exceed the immutable maximum.
- The configured offering holds the normal persistent mint role; the local script's temporary
  company-vesting mint role is revoked, and the market manager never receives mint authority.
- Only the redemption controller can burn another holder's tokens.
- The issuer can withdraw only its proceeds category.
- Market funding can use only its category and only while the protected reserve meets its minimum.
- Vault accounting cannot exceed the actual mUSD balance.
- Holder revenue is checkpointed before every mint, burn, or transfer and cannot be claimed twice.
- Yield-excluded balances do not enter the circulating-supply denominator; exclusion changes
  checkpoint already-earned revenue before eligibility changes.
- Redemptions burn first and never pay more than available reserve liquidity.
- Uniswap callbacks require the canonical pool, active payload hash, correct tokens, correct
  direction, bounded input, slippage limits, and deadlines.
- A market pause stops new inventory, funding, liquidity, and swaps while preserving the keeper's
  ability to remove liquidity and return idle mUSD to the vault.

## Threat model

The design considers unauthorized role use, token-supply inflation, accounting-category confusion,
direct stablecoin transfers, reentrancy at financial entry points, stale or rapidly moving NAV,
spot manipulation relative to TWAP, market/NAV divergence, malicious callbacks, wrong callback
tokens or direction, expired execution, slippage, rounding across 6 and 18 decimals, double revenue
claims, incorrect yield eligibility, and reserve runs.

OpenZeppelin `SafeERC20`, `ReentrancyGuard`, `Pausable`, `ERC20Permit`, checked arithmetic, basis-point
constants, bounded loops, and stateful invariants provide defense in depth. Administrators should be
multisigs with separated verifier, keeper, pauser, and revenue-depositor keys.

## Emergency behavior

Suspension or default immediately stops new issuance and market actions through registry gates.
Component pausers can separately stop token transfers, offering purchases, revenue claims/deposits,
vault releases, redemptions, and market management. Emergency redemption requires a suspended or
defaulted asset and uses a verifier/keeper-set settlement reference capped by liquid backing. At
maturity, only maturity-mode redemption is accepted.

When SOLAR01 transfers are paused, the token still permits the single authorized redemption
controller to burn tokens for an approved settlement. This burn-only escape hatch cannot transfer or
mint tokens and prevents an emergency pause from trapping holders who are eligible to redeem.

For the market manager, pausing is asymmetric by design: risk-increasing actions stop, while
`removeLiquidity`, `collectFees`, and `returnStablecoinToVault` remain available to the authorized
keeper. Tests verify that liquidity can be unwound during a pause and that normal guarded operation
resumes only after an authorized unpause.

## Verification evidence

The market-making tests cover three complete position lifecycles plus the control and failure paths
around them. Assertions include role boundaries, pool and manager balances, protected-reserve
isolation, rollback after slippage failure, both swap directions, configured ticks and liquidity,
rebalance cooldown, oracle direction, NAV freshness and divergence, maturity, asset status, pause,
and vault solvency.

These tests run with the broader lifecycle, unit, fuzz, and financial invariant suites. The invariant
handler continues to assert reserve solvency, supply caps, redemption limits, revenue bounds, and
the equality between token supply and outstanding obligations across randomized action sequences.

## Risk register

| Risk | Current mitigation | Residual risk / required work |
| --- | --- | --- |
| Unauthorized issuance | Immutable cap and role-gated mint | Admin can grant roles; production governance/timelock required |
| Reserve category theft | Separate ledgers and scoped vault roles | Admin/role compromise remains critical |
| NAV manipulation | Verifier role, per-update movement bound, staleness | Central verifier remains trusted; evidence/oracle system required |
| Spot manipulation | TWAP and spot/TWAP deviation gate | Window/cardinality and economic attack cost untested on canonical pool |
| Market/NAV divergence | TWAP/NAV emergency threshold | NAV itself may be wrong or stale within threshold |
| Malicious pool callback | Immutable pool, active payload hash, direction/input checks | Canonical pool/factory integration needs fork validation |
| Reentrancy | Guards and checks/effects ordering at financial entries | Malicious-token matrix is incomplete |
| Revenue capture by transfer | Pre-transfer checkpoint hook | Admin-controlled exclusion remains a governance risk |
| Redemption reserve run | Backing cap, period limit, minimum ratio | Correlated mass redemption and offchain settlement not modeled |
| Keeper error | Tick alignment, max shift, safety gates, cooldown | Proposed tick direction is not orientation-enforced; remint can fail separately |
| Keeper outage | Manual roles and recoverable pause unwind | No automation, alerting, failover, or SLA |
| Frontend misinformation | Disclosures and some mock labels | Many fixtures resemble live values; provenance migration required |
| Indexer inconsistency | Not applicable yet | Reorg-safe backend is not implemented |
| Company allocation abuse | Vesting/exclusion primitive and local example | Factory settlement does not enforce allocation or vesting atomically |
| Upgrade/admin compromise | Non-upgradeable current components | Role administration is powerful and local demo consolidates roles |

## Security-sensitive implementation details

- `slide` and `sweep` enforce spot/TWAP signal direction but do not prove the proposed raw tick move
  represents that economic direction for the current token ordering.
- `removeLiquidity`, `collectFees`, and `returnStablecoinToVault` intentionally lack the manager's
  pause gate for recovery.
- `RevenueDistributor.setYieldExcluded` is an admin policy control and can materially change the
  holder-yield denominator.
- The local script temporarily grants the deployer issuance authority to mint company vesting, then
  revokes it. Production settlement should avoid ad hoc mint-role windows.
- `emergencySettlementPrice == 0` means fallback to NAV in the current redemption calculation; zero
  is not a “pay nothing” emergency reference.
- Current contracts are non-upgradeable. Migration requires explicit new deployments/state handling.
- Market callbacks authenticate the configured pool, but configuring an untrusted approved pool
  factory would still undermine assumptions. Pool-factory approval is security-critical.

### Transfer compliance (added 2026-08-27)

- `IdentityRegistry` is protocol-wide; compromising `REGISTRY_AGENT_ROLE` lets an attacker
  whitelist arbitrary wallets. Treat that role like a verifier key: multisig, rotated, monitored via
  `IdentityRegistered` / `ClaimExpiryUpdated` events.
- `TRANSFER_AGENT_ROLE` can freeze and `forcedTransfer` any balance. It must never be held by a hot
  keeper key. The factory grants it to `protocolAdmin` at handoff.
- `setComplianceExempt` is the perimeter's escape hatch. Only non-investor infrastructure may be
  exempt; exempting an EOA re-opens permissionless transfers for that address. Backend and UI must
  surface `ComplianceExemptionChanged` events.
- Exemption is per leg. A pool can pay only verified wallets, so KYC is enforced at the AMM
  boundary. Any contract that custodies tokens transiently (position manager, aggregator) is a
  policy decision, not a default.
- Burns bypass the sender verification check by design; an expired claim can still redeem. A frozen
  address cannot.
- `ModularCompliance.canTransfer` is a view over untrusted modules: a malicious or buggy module can
  brick transfers. Module addition is admin-only and should be time-locked in production.

## Incident response outline

This is a design outline, not a production runbook:

1. Identify affected asset, chain, component, and last trusted block/NAV.
2. Pause the narrowest required components; suspend the asset when issuance/market activity must stop.
3. Preserve authorized market unwind paths and reconcile manager/pool balances.
4. If default or emergency settlement is justified, publish/document lifecycle decision and set a
   conservative emergency reference no higher than NAV.
5. Verify vault actual balance, all category ledgers, token supply, excluded supply, and outstanding
   obligations before enabling claims.
6. Communicate that market price, NAV, and available redemption may differ.
7. Resume only after root cause, role/key status, NAV freshness, oracle safety, and accounting are
   independently verified.
8. Publish all role, pause, status, NAV, settlement, and fund-movement transactions.

## Known limitations

- No audit has been performed; this is hackathon code.
- The test pool/factory are callback harnesses, not economic simulations or production AMMs.
- Range changes use an explicit remove/update/remint lifecycle; reminting is a separate keeper action.
- Discovery and intermediary positions share the safe position machinery but do not yet have an
  automated material-gap classifier.
- NAV is a role-controlled mock oracle with a timestamp and movement limit, not a decentralized
  production oracle.
- Revenue precision can leave sub-base-unit dust in the distributor.
- Yield exclusion is currently controlled by the revenue distributor's default administrator. A
  production deployment should restrict changes to verified vesting or protocol custody contracts
  through governance delay and public monitoring.
- Fee collection in the generic interface cannot distinguish principal from fees without deeper
  position accounting; events report actual collected amounts.
- The mock pool cannot validate production fee growth, tick crossing, price impact, liquidity
  exhaustion, or MEV behavior. Local swap and collection tests validate manager controls and token
  accounting only.
- The frontend uses environment-configured local addresses and mixes selected live writes with many
  static fixtures. Some fallback values can look live and must be replaced with explicit error/stale
  states.
- `slide`/`sweep` do not enforce orientation-aware tick direction for the keeper-proposed range.
- The local company vesting mint is script-level wiring, not atomic factory settlement.
- No backend, reorg-safe indexer, event monitor, or OHLC service exists yet.
- KYC, sanctions controls, custody, legal claims, fiat rails, document permissions, upgradeability,
  governance delay, and production monitoring are out of scope.

## Pre-production requirements

Independent audits, formal role and key management, legal review, canonical Uniswap integration
tests on a fork, oracle threat analysis, keeper failure recovery, MEV analysis, fee/principal
accounting, sanctions/KYC integration, incident drills, and staged value caps are required before
handling real assets or funds.
