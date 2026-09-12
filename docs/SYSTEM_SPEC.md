# ArcReserve System Specification

Status: implementation-aligned specification for the current hackathon MVP.

This document describes what the repository implements today. Target commercial behavior that is
not enforced onchain is explicitly marked **target only**. For agent instructions and work order,
start with [`CLAUDE.md`](../CLAUDE.md).

## 1. Scope and terminology

ArcReserve creates one isolated contract system per verified asset series. The demo series is
SOLAR01. A series has its own token, vault, offering, revenue distributor, redemption controller,
market manager, and pool.

| Term | Precise meaning in this repository |
| --- | --- |
| Asset token | Capped 18-decimal ERC-20 participation token for one asset series |
| mUSD | Six-decimal faucet token used only for local/test stablecoin flows |
| Verified NAV | Six-decimal per-token reference published by a verifier |
| Market spot | Pool price derived from `slot0` |
| ~~TWAP~~ | **Removed from the engine (D-036).** No time-weighted price is published; `marketPrices()` returns 0 in the `twapPrice` and `meanTick` slots |
| Protected reserve | `AssetVault.redemptionReserve`; available only to authorized redemption flow |
| Market allocation | `AssetVault.marketMakingAllocation`; the only vault category withdrawable by the market manager |
| Protected floor reference | `min(NAV, liquid reserve backing per issued token)` under normal mode |
| Market floor range | A concentrated-liquidity position funded from market inventory; not protected reserve |
| Issued supply | Current ERC-20 `totalSupply`, including vesting balances |
| Investor supply | `totalSupply - issuerAllocationSupply` (D-024); the denominator for backing, the reserve requirement and the redemption price |
| Issuer allocation | Balances of addresses flagged `setIssuerAllocation`; non-redeemable in every mode, outside the backing denominator |
| Yield-eligible supply | `totalSupply - excludedSupply`; `RevenueDistributor.yieldEligibleSupply()`. Distinct from investor supply - a released company token can be investor supply while still yield-excluded |
| Authorized supply | Immutable token `maximumSupply` |
| Issuance headroom | Authorized supply that has not been minted; policy concept, not a dedicated controller today |

## 2. Units and rounding

| Quantity | Base-unit scale |
| --- | --- |
| SOLAR01 amounts | `1e18` units per token |
| mUSD amounts | `1e6` units per mUSD |
| NAV and token prices | `1e6` units per whole asset token |
| Basis points | `10_000 = 100%` |
| Uniswap square-root price | Q64.96 |
| Revenue accumulator | `1e30` internal accuracy |

Conversions use full-precision `Math.mulDiv` and round down:

```text
stable amount = asset base units * six-decimal price / 1e18
asset amount  = stable base units * 1e18 / six-decimal price
```

Rounding down prevents the offering from issuing more asset value than the stablecoin received.
Split residuals are assigned to the final category so each deposit is fully accounted:

```text
primary market share = gross - issuer share - reserve share
revenue protocol share = gross - holder share - reserve share - operator share
```

## 3. Asset lifecycle

The enum order is fixed in `IAssetRegistry.AssetStatus`:

| Numeric value | State | Meaning |
| --- | --- | --- |
| 0 | Pending | Submitted and awaiting verifier decision |
| 1 | Approved | NAV approved; component deployment allowed |
| 2 | Active | Issuance and normal market actions may operate before maturity |
| 3 | Suspended | New normal issuance/market actions stop; emergency redemption may be enabled |
| 4 | Defaulted | Terminal distress state; emergency redemption mode |
| 5 | Matured | Term ended; maturity redemption mode |
| 6 | Closed | Administratively closed or rejected |

Implemented transitions:

```text
submitAsset                          -> Pending
Pending   --approveAsset-----------> Approved
Pending   --rejectAsset------------> Closed
Approved  --factory.activateAsset--> Active
Active    --suspendAsset-----------> Suspended
Suspended --resumeAsset------------> Active
Active/Suspended --markDefault-----> Defaulted
Active/Suspended --markMatured-----> Matured, only at/after maturity timestamp
any known state --closeAsset-------> Closed, admin only
```

`canIssue` is true only while state is Active and the maturity timestamp has not arrived.

NAV updates are accepted only in Approved or Active state, must be nonzero, and may not move beyond
`maxNAVMovementBps` relative to the previous NAV. The default movement limit is 20%. A NAV becomes
stale after two days by default.

## 4. Deployment and role wiring

### 4.1 Factory preconditions

Deployment is **two transactions** (D-033), not one: a single call measured 18,424,318 gas against
the canonical Uniswap factory and 15,294,153 against the mock, over Base Sepolia's EIP-7825 cap
(2²⁴ = 16,777,216) and Hedera's 15,000,000 respectively. Measured after the split (mock pool):
phase 1 ≈ 8.54M, phase 2 ≈ 7.27M.

`AssetFactory.beginAssetSystem(params)` deploys the token, vault, offering and revenue
distributor, and requires:

- caller has `ISSUER_ROLE` on the factory;
- caller is the issuer stored for the asset ID;
- registry state is Approved;
- no previous deployment exists for the asset (`AlreadyDeployed()`), and no phase-1 record is
  already open for it (`AlreadyBegun()`);
- **`keccak256(abi.encode(params))` equals the registry's `termsHashOf(assetId)`** (D-026), else
  `TermsMismatch()`. Checked before structural validation, so nothing unapproved gets further;
- the pool factory is allowlisted;
- NAV is nonzero and maturity is in the future;
- supply, offering, reserve, redemption, operator, and pool parameters are valid;
- `identityRegistry` is a non-zero address (the token is always permissioned); and
- offering inventory does not exceed maximum supply.

`AssetFactory.completeAssetSystem(assetId, params)` deploys the redemption controller, the pool
and the market manager, then calls `setAssetContracts`, `activateAsset` and the D-032 role
handoff, emitting `AssetSystemDeployed` once. It requires:

- a phase-1 record for `assetId` (`NotBegun()`);
- **the caller is the wallet that ran phase 1** — not merely the registry's current `issuerOf`, so
  a half-built system cannot be adopted by another key (`UnauthorizedIssuer()`);
- `params.assetId == assetId` (`AssetIdMismatch()`); and
- `keccak256(abi.encode(params))` equals the hash **phase 1 recorded** (`TermsMismatch()`). This is
  the phase-1 value, not the registry's current one, so a `reapproveTerms` between the phases
  cannot swap the system being completed.

Phase 2 is atomic, so a failed attempt (out of gas, a pool created underneath it) leaves the
phase-1 record intact and the call can simply be repeated — a failure never burns the assetId.

**The window between the phases.** Until phase 2 runs the asset stays `Approved` and the registry
has never been told the component addresses, so the system is inert rather than merely unused:
`offering.buy` fails `canIssue`, the distributor has no supply to divide, and the vault refuses its
three direct inflows (`depositInitialReserve`, `depositReserve`, `depositAssetRevenue`) with
`SystemNotActive()`. That vault gate keys on `Approved` specifically, not on "not Active" — a
suspended asset in shortfall can only be cured by an issuer deposit, so blocking those states would
deadlock D-023 enforcement.

`abandonAssetSystem(assetId)` is the way out, callable by the phase-1 caller or the factory admin.
It clears the pending record and renounces every factory role on the four orphans, leaving them
permanently inert; a registry admin then `closeAsset`s the asset. There is deliberately **no TTL**:
a short one races a slow issuer into losing a half-paid deployment, and a long one is useless.

**Term-sheet binding (D-026).** `approveAsset(assetId, initialNAV, termsHash)` records the hash of
the exact `DeploymentParams` the verifier reviewed. The struct *is* the canonical term sheet, and the
offchain legal pack references the same hash. A zero hash is rejected rather than treated as unbound,
since an unbound approval would let any parameters through.

`reapproveTerms(assetId, newTermsHash)` amends the binding, and is deliberately restricted to the
`Approved` state. Once `setAssetContracts` has run, the stored hash describes what was actually
deployed; letting it drift afterwards would make `termsHashOf` a claim nobody could rely on. A
post-deployment amendment is an offchain legal event, and re-binding it onchain would mean
redeploying the series.

### 4.2 Components deployed per series

1. `AssetToken`
2. `AssetVault`
3. `PrimaryOffering`
4. `RevenueDistributor`
5. `RedemptionController`
6. Uniswap-compatible pool
7. `AssetMarketManager`

The pool is reused when the approved factory already reports one for the token/stablecoin/fee tuple;
otherwise it is created and initialized.

### 4.3 Post-deployment wiring

| Grant or link | Recipient |
| --- | --- |
| Token issuance controller | Primary offering |
| Token redemption controller | Redemption controller |
| Token revenue hook | Revenue distributor, set once |
| Vault allocator | Primary offering and revenue distributor |
| Vault redemption controller | Redemption controller |
| Vault market manager | Asset market manager |
| Revenue depositor | Configured depositor on distributor; also granted on vault |
| Redemption keeper | Protocol admin |
| Market keeper | Protocol admin |
| Token identity registry | `params.identityRegistry` |
| Token compliance exemption | Market manager and canonical pool |
| Token transfer agent | Protocol admin |
| Component admin and pauser | Protocol admin |

`ModularCompliance` is not wired by the factory. The admin binds it after deployment
(`compliance.bindToken(token)` then `token.setCompliance(compliance)`), as `DeployLocal` does.

The factory registers component addresses, activates the asset, grants administration to the
protocol admin, and renounces its temporary component admin roles.

### 4.4 Role trust table

| Component | Role | Authority |
| --- | --- | --- |
| Registry | `ISSUER_ROLE` | Submit asset records |
| Registry | `VERIFIER_ROLE` | Approve/reject, publish NAV, suspend/resume, default, mature |
| Registry | `FACTORY_ROLE` | Register components and activate |
| Factory | `ISSUER_ROLE` | Deploy an approved issuer-owned series |
| Token | `ISSUANCE_CONTROLLER_ROLE` | Mint within cap |
| Token | `REDEMPTION_CONTROLLER_ROLE` | Burn holder tokens for redemption |
| Vault | `ALLOCATOR_ROLE` | Credit primary and revenue categories after receipt |
| Vault | `MARKET_MANAGER_ROLE` | Withdraw/return only market allocation |
| Vault | `REDEMPTION_CONTROLLER_ROLE` | Release only redemption reserve |
| Revenue | `REVENUE_DEPOSITOR_ROLE` | Deposit asset revenue |
| Redemption | `KEEPER_ROLE` | Set emergency settlement reference |
| Market | `KEEPER_ROLE` | Configure, fund, trade, and rebalance positions |
| Components | `PAUSER_ROLE` | Pause component-specific risk paths |
| Components | `DEFAULT_ADMIN_ROLE` | Manage roles and policy where exposed |

Production deployments should split these authorities across multisigs or scoped operators. The
local demo deliberately uses the first Anvil account for most roles.

## 5. Token specification

`AssetToken` implements ERC-20, ERC-20 Permit, ERC-20 Pausable, and AccessControl.

Properties:

- immutable asset ID;
- immutable registry address;
- immutable maximum supply;
- one-time revenue distributor link;
- role-gated mint;
- role-gated burn-for-redemption;
- a transfer hook invoked before mint, burn, or transfer accounting completes; and
- permissioned transfers through an identity registry, freeze controls, and modular compliance
  (see 5.1).

During a token pause, ordinary transfers and minting stop. A narrow escape hatch permits the
configured redemption controller to perform a burn to the zero address so an authorized emergency
or maturity settlement cannot trap holders.

### 5.1 Transfer restrictions (permissioned token)

Every `_update` evaluates, in order, and reverts with the first custom error hit:

| # | Rule | Error | Applies to |
| --- | --- | --- | --- |
| 1 | Sender address frozen | `SenderFrozen()` | transfer, burn |
| 2 | `value > balance - frozenTokens` | `InsufficientUnfrozenBalance()` | transfer, burn |
| 3 | Recipient address frozen | `RecipientFrozen()` | transfer, mint |
| 4 | Sender not verified and not exempt | `SenderNotVerified()` | transfer only (burns skip) |
| 5 | Recipient not verified and not exempt | `RecipientNotVerified()` | transfer, mint |
| 6 | `compliance.canTransfer` false | `ComplianceCheckFailed()` | transfer, mint, burn |

`transferRestriction(from, to, value)` returns the selector of the first failing rule (or
`EnforcedPause()` while paused, or `bytes4(0)` when allowed) without reverting.

`forcedTransfer` (`TRANSFER_AGENT_ROLE`) skips rules 1, 2, 4, and 6 for the sender, unfreezing
partial tokens as needed; rules 3 and 5 still apply to the recipient.

Exempt accounts are set by `DEFAULT_ADMIN_ROLE` via `setComplianceExempt`. The factory exempts the
canonical pool and the market manager. Exemption covers only that account's own leg.

`ModularCompliance` is bound per token (`bindToken` on the compliance, then `setCompliance` on the
token). Hooks `created` / `transferred` / `destroyed` run after state changes and are callable only
by the bound token. Modules receive the compliance address as `msg.sender` and key configuration on
it.

## 6. Vault specification

### 6.1 Accounting categories

| Category | Credited by | Debited by | Intended use |
| --- | --- | --- | --- |
| Redemption reserve | Issuer deposit, offering split, revenue split, asset-revenue allocation | Redemption controller | Reserve-limited holder settlement |
| Market allocation | Offering split, returned market funds | Market manager | Secondary-market inventory only |
| Asset revenue | Authorized asset-revenue deposit | Allocator transfer to reserve | Separately tracked operating proceeds |
| Issuer proceeds | Offering split | Issuer | Capital available to issuer |
| Protocol fees | Revenue split | Admin | Protocol revenue |

### 6.2 Solvency

```text
totalAccounted = redemptionReserve
               + marketMakingAllocation
               + assetRevenue
               + issuerProceeds
               + protocolFees

obligationsAtNAV = investorSupply * NAV / 1e18
minimumRequiredReserve = obligationsAtNAV * minimumReserveRatioBps / 10_000

isSolvent = vault mUSD balance >= totalAccounted
         && redemptionReserve >= minimumRequiredReserve
```

The market manager cannot withdraw when the reserve is below its required minimum. It cannot select
another category. Returning market funds increments only the market allocation.

### 6.3 Transfer ordering

- Initial reserve: transfer from issuer, then credit reserve.
- Primary purchase: offering transfers gross amount to vault, then credits categories.
- Revenue reserve/protocol: distributor transfers to vault, then credits categories.
- Redemption: controller burns tokens, then vault debits reserve and transfers mUSD.
- Market withdrawal: vault debits market allocation, transfers mUSD, then reasserts accounting.

### 6.4 Reserve schedule and shortfall (D-023)

The vault carries a sinking-fund schedule. `targetBacking` is mUSD per **investor-held** token
(6 decimals) and rises linearly across the term:

```text
backing(t)       = redemptionReserve * 1e18 / investorSupply        (6d, flat between transactions)
targetBacking(t) = startBacking + (targetBacking - startBacking) * (t - startTime) / (maturity - startTime)
                   clamped to startBacking before startTime and to targetBacking from maturity on
behindSchedule   = investorSupply > 0 && backing(now) < targetBacking(now)
```

Demo schedule: `0.30 -> 1.00` over three years, 30-day grace.

**Shortfall start is derived, not observed.** Because the target curve is monotonically increasing,
the time at which it overtook the current backing is recoverable in closed form by inverting the
line:

```text
shortfallStartedAt = startTime + (backing - startBacking) * (maturity - startTime) / (targetBacking - startBacking)
                     (= startTime when backing <= startBacking; 0 when not behind)
isInEnforcedShortfall = shortfallStartedAt != 0 && now >= shortfallStartedAt + graceSeconds
```

This matters for enforcement integrity: nothing has to have been called for the gate to close. An
issuer cannot let a dormant asset drift behind, then be the first to touch it and claim a fresh
grace window. Backing only rises while an asset is Active (a redemption pays at most `backing`), so
inverting the *current* backing yields a crossing time at or after the true one - the bound errs in
the issuer's favour and can never over-punish.

`syncShortfall()` is permissionless, works while paused, and exists only to publish
`ReserveShortfallEntered` / `ReserveShortfallCleared` for indexers, the verifier and the UI. The
stored `shortfallSince` mirrors the derived value at the last sync; **enforcement never reads it**.
Every vault operation that moves the reserve syncs automatically.

**Enforcement.** `withdrawIssuerProceeds` reverts `ReserveShortfallActive()` while in enforced
shortfall. Redemption is deliberately *not* gated - only the issuer's capital is frozen, investors
keep their exit. Headroom issuance will join the gate when it exists.

`depositReserve(amount, periodId)` is the issuer's scheduled contribution, tagged with the reporting
period it settles, and emits `ReserveContribution`.

### 6.6 Residual return (D-023)

Once an asset is `Closed` **and** the maturity window has passed, the issuer may call
`releaseResidualReserve()`:

```text
obligationsAtPar = investorSupply * min(NAV, par) / 1e18
residual         = redemptionReserve > obligationsAtPar ? redemptionReserve - obligationsAtPar : 0
```

Only the excess is released. Every remaining holder keeps full par cover, so a holder who never
redeemed is never stranded by the release - an underfunded asset simply has no residual, and the
call reverts `NothingToRelease()`. Guarded by `AssetNotClosed()`, `MaturityWindowOpen()` and issuer
identity; emits `ResidualReserveReleased`.

### 6.5 Reserve yield (D-023)

`accrueReserveYield(amount)` is callable only by `YIELD_SOURCE_ROLE` and routes yield earned on the
protected reserve by schedule state:

| Schedule state | Destination |
| --- | --- |
| Behind schedule | `redemptionReserve` - the yield helps the sinking fund catch up |
| On or ahead of schedule | `issuerProceeds` |
| **No schedule configured** | `redemptionReserve` |

The last row is a deliberate conservative default: forgetting to configure a schedule must not
silently route the investors' reserve yield to the issuer.

Funds are **pulled** from the caller, so classification is atomic and a stray transfer into the vault
can never be swept up as yield. A rebasing yield-bearing stablecoin would instead grow the balance in
place; that integration would classify the unaccounted surplus rather than pulling.

`MockYieldSource` (`src/mocks/`) is the demo stand-in - it holds mUSD and hands it over on demand so
the local demo can show both branches without an external protocol.

## 7. Current primary offering

**Class-based subscription caps (D-028).** `investorClass` in the protocol identity registry is the
source of truth: 1 retail, 2 accredited, 3 institutional. `setClassLimit(class, walletLimit,
aggregateCap)` configures a class; an unconfigured class falls back to the global
`walletPurchaseLimit`, so the mechanism changes nothing until deliberately used.

A configured class limit **replaces** the global limit rather than stacking with it. Stacking would
cap an institution at the retail-era global figure, which is the opposite of the intent;
`type(uint256).max` therefore means "uncapped within the fundraising cap", which still bounds
everyone. `aggregateCap` optionally limits the share of the whole raise one class may take, tracked
in `raisedByClass`.

`remainingAllowance(buyer)` is the number a UI should display: the minimum of the effective wallet
cap, the class aggregate cap, and what is left of the raise. `walletPurchaseLimit` alone is wrong
once any class is configured.

Proceeds are split 65% issuer / 30% protected reserve / 5% market allocation (D-023). The 30%
holdback is the reserve's opening balance and the first point on the sinking-fund schedule; the
issuer's fresh working capital is the 65%.

The current offering is direct mint-on-purchase:

```text
buyer approves mUSD
-> offering validates time/status/limits
-> offering calculates token output
-> gross mUSD moves to vault
-> vault records 70% issuer / 20% reserve / 10% market
-> offering mints SOLAR01 to buyer
```

Limits:

- fixed start and end timestamps;
- fundraising cap;
- per-wallet stablecoin cap;
- token inventory cap;
- minimum stablecoin purchase;
- caller-provided minimum token output; and
- global token maximum supply.

No subscription escrow, refund pool, settlement threshold, issuer partial-settlement acceptance, or
atomic batch settlement exists today. Those are target-only requirements in `BUSINESS_MODEL.md`.

## 8. Revenue distribution

Deposits are made per reporting period (D-022):

```text
depositRevenue(amount, periodId, reportHash)
```

`periodId` and `reportHash` are recorded, not validated - the verifier reconciles them against the
term sheet offchain. `revenueByPeriod[periodId]` accumulates, so a period may be topped up.

**The split is dynamic (D-023).** Two variants are stored, and the one in force is chosen per
deposit by reading `vault.isBehindSchedule()` live, so it can never go stale:

| Destination | On schedule | Behind schedule |
| --- | ---: | ---: |
| Yield-eligible holders | 6,000 | 4,000 |
| Protected reserve | 2,500 | 4,500 |
| Operator | 1,000 | 1,000 |
| Protocol fees | 500 | 500 |

While the sinking fund is behind, twenty points move from holders to the reserve so it catches up
faster. Operator and protocol shares never move. Curing a shortfall restores the holder share on the
very next deposit with no admin action.

Both variants are admin-settable via `setRevenueSplits`, bounded so the mechanism cannot be abused:
each must total 10,000, `holderBps >= MIN_HOLDER_BPS` (3,000), `operatorBps <= MAX_OPERATOR_BPS`
(1,500), `protocolBps <= MAX_PROTOCOL_BPS` (1,000), and the behind-schedule variant may never route
*less* to the reserve or *more* to holders than the on-schedule one.

**Reporting cadence.** `setReportingPolicy(periodSeconds, graceSeconds)` declares how often a report
is expected. `isReportingOverdue()` is true once `lastRevenueDepositAt + periodSeconds +
graceSeconds` has passed. It is surfaced to the verifier and UI and **gates nothing onchain** - a
missing report is an offchain covenant breach, not a protocol failure. A zero period disables the
view rather than reporting every asset as late.

The holder allocation remains in the distributor until claimed. Reserve and protocol allocations
move immediately to the vault. Operator allocation remains in the distributor until the immutable
operator claims it.

Accumulator model:

```text
eligibleSupply = token.totalSupply - excludedSupply
cumulativeRevenuePerToken += holderAmount * 1e30 / eligibleSupply
```

The transfer hook checkpoints sender and recipient before balances change. This preserves earned
revenue across transfers and prevents a recipient from receiving distributions deposited before it
owned the tokens.

Yield exclusion rules:

- exclusion is admin-controlled;
- an account must be nonzero;
- previously earned revenue is checkpointed before exclusion;
- an excluded balance contributes to `excludedSupply`;
- excluded balances have zero eligible balance;
- transfers into/out of excluded accounts update `excludedSupply`; and
- removing exclusion sets debt to the current accumulator, preventing retroactive yield.

Under **D-031 there is no company token allocation**, so in the demo nothing is flagged and
`investorSupply == totalSupply` at all times. Yield exclusion (D-006) remains available for any
address the protocol needs to exclude.

The D-024 machinery is retained as a general-purpose guard: an address flagged
`setIssuerAllocation` is subtracted from `investorSupply` and cannot redeem in any mode. Yield
exclusion (D-006) and issuer-allocation flagging (D-024) are separate switches; setting one does not
set the other. If an allocation is ever reintroduced, note that the flag follows the **address**,
not the tokens - releasing or selling flagged tokens to an investor moves them into `investorSupply`
and lowers backing per token, which is why `levelUp()` must re-check `price(level) <= min(NAV,
backing)` on every call rather than trusting a cached level (D-025).

## 9. Redemption

### 9.1 Modes

| Mode | Required asset status | Reference | Extra condition |
| --- | --- | --- | --- |
| Normal | Active | NAV | - |
| Maturity | Matured | `min(NAV, par)` | Only until `vault.maturityWindowEndsAt()` |
| Emergency | Suspended or Defaulted | Emergency price when nonzero; otherwise NAV | - |

Maturity is the only mode capped at **par** (`vault.maturityParValue()`, the schedule's end target,
normally 1.000000). SOLAR01 is a note: a holder's maturity claim is capped at par, and backing above
par is the issuer's residual rather than holder upside. Normal and emergency modes are uncapped and
keep paying `min(reference, backing)`.

Maturity redemption closes at `assetMaturity + maturityWindowSeconds`, reverting
`MaturityWindowClosed()`. A zero window disables both the deadline and residual release - the safe
default for an unconfigured asset.

### 9.2 Price and limits

```text
liquidBackingPerToken = redemptionReserve * 1e18 / investorSupply
redemptionPrice = min(referencePrice, liquidBackingPerToken)
payout = tokenAmount * redemptionPrice / 1e18
```

The controller rejects zero amounts, wrong modes, zero price, minimum-output failure, insufficient
reserve liquidity, and period-limit overflow. Period usage resets lazily on the first redemption at
or after the next period boundary.

An emergency price may not exceed current NAV. The backing cap still applies after it is set.

## 10. Market-making specification

### 10.1 Position roles

| Position | Intended inventory | Role |
| --- | --- | --- |
| ReserveFloor | Stable-biased | Lower market-depth range from market allocation |
| Anchor | Two-sided | Main trading/reference band |
| Discovery | Asset-token-biased | Controlled inventory for higher price discovery |
| Intermediary | Two-sided | Optional bridge when a material gap exists |

The manager owns fungible token balances and records liquidity per configured range. It does not own
or mint asset supply beyond inventory explicitly transferred by a funder.

### 10.2 Safety evaluation order

`safetyState(includeCooldown)` reports the first failure in this order:

1. manager paused;
2. asset not Active;
3. maturity timestamp reached;
4. NAV stale;
5. *(retired — `SpotTwapDeviation` keeps enum value 5 and is never returned, D-036)*;
6. **spot**/NAV deviation above policy;
7. vault insolvent or reserve below minimum; and
8. cooldown not elapsed, when requested.

Default policy:

| Parameter | Default |
| --- | ---: |
| Rebalance cooldown | 30 minutes (deploy scripts configure **1 second**) |
| Maximum **spot**/NAV deviation | 2,000 bps |
| Maximum endpoint tick shift | 1,200 ticks |

`setSafetyPolicy` keeps five parameters for ABI stability, but the first (`twapWindow`) and third
(`spotTwapBps`) are accepted and ignored, no longer validated, and emitted as 0.

### 10.3 Liquidity lifecycle

`addLiquidity` requires keeper authority, an unpaused manager, configured position, current deadline,
passing safety state, bounded callback inputs, and returned amounts within caller minimum/maximum
bounds.

`removeLiquidity` requires keeper authority, a valid amount no larger than recorded liquidity,
deadline, and minimum collected outputs. It remains callable while paused to preserve emergency
unwind capability.

`collectFees` and `returnStablecoinToVault` also remain callable while paused. This is intentional.

### 10.4 Rebalances

- `slide` additionally requires spot to have left the **anchor's own range on the upside** (D-036).
- `sweep` additionally requires spot to have left the anchor range on the **downside**.
- Both comparisons are made in price terms and resolve through `assetIsToken0`, since with the asset
  as token1 a higher price is a lower tick. While spot is inside the band neither is callable.
- `refreshDiscovery` has no separate price-direction check beyond the common safety gates.
- `rebalanceToNAV` uses the common safety gates.

The target position must have zero recorded liquidity. New endpoints must be valid tick-aligned
ranges and each endpoint may move no farther than `maxTickShift`. A successful update records the
current timestamp and starts cooldown. Remint is a separate transaction.

Every successful rebalance then **opportunistically advances the published protected floor**
(D-036), so the level tracks a rising reserve without a separate keeper call. It can never fail the
rebalance: an unset controller, an ineligible level or a reverting controller are each swallowed and
reported through `FloorLevelUpSkipped(reason)`. The call is deliberately not reentrancy-guarded —
see `SECURITY.md` for the admin-trust assumption that makes that acceptable under D-027.

### 10.5 Canonical pool events and the demo price feed (task 10)

`IUniswapV3Pool` declares `Initialize(uint160,int24)` and
`Swap(address indexed,address indexed,int256,int256,uint160,uint128,int24)` with v3-core's exact
argument order, so anything implementing it carries them in its ABI and an indexer decodes a demo
pool log through the same path a real pool would need. The `Swap` topic0 is asserted against the
canonical `0xc42079f9...ca67` in `test/unit/MockPoolSwapEvents.t.sol`.

`MockUniswapV3Pool` moves `sqrtPriceX96` and `spotTick` on every swap and emits both events.
Direction is canonical: selling token0 lowers the token1/token0 price, which is a lower tick.
Magnitude is a labelled linear stand-in - `swapImpactUnit` of input moves one `tickSpacing`, capped
by `maxTickMovePerSwap` - and setting `swapImpactUnit` to zero pins the price for tests that need a
deterministic oracle.

The mock still models no impact curve, no tick crossing, no fee growth and no liquidity exhaustion.
Anything derived from it is a **labelled demo feed, never price discovery**, and must stay badged as
such in the UI.

### 10.6 Callback authentication

For mint and swap, the manager creates a nonce-bearing callback payload and stores its hash only for
the active external pool call. A callback succeeds only when:

- caller is the immutable pool;
- the payload hash matches the active operation;
- payload token addresses match immutable token0/token1;
- swap delta signs match the requested direction; and
- amount owed does not exceed the caller's configured maximum input.

The active hash is cleared after the pool call. Reentrancy guards protect the entry functions.

## 10.6 Published protected floor (D-025)

`FloorController` publishes the protected-floor reference as a **pool tick** that ratchets upward.

```text
backing    = vault.currentBacking()                    (6d mUSD per investor token)
ceiling    = min(NAV, backing)
nextTick   = assetIsToken0 ? floorTick + tickSpacing : floorTick - tickSpacing   (price-up)
levelUp()  = permissionless; advances one tickSpacing iff
             price(nextTick) <= ceiling and the cooldown has elapsed
```

One step per call, so a large reserve inflow becomes a paced climb rather than a gap. Demo spacing is
60 ticks, about +0.6% a step, with a 30-minute cooldown shared with the rebalance cooldown.

`priceAtTick` applies the same conversion the market manager applies to `slot0`, so the published
floor and the market price are directly comparable 6-decimal values.

**It is a reference, not a bid** (D-010). `redeem()` is unchanged: it keeps paying the continuous
`min(NAV, backing)`, which is always at or above the published level.

**Why the ratchet is safe.** Backing is non-decreasing while an asset is Active - a redemption pays
at most `currentBacking` per token, so it can only raise backing for the holders who stay. That is
asserted in the invariant suite, as is `floorPrice <= backing`.

**The one asymmetry, stated honestly.** `floorPrice <= backing` holds permanently. `floorPrice <=
NAV` is only guaranteed *at the moment of each level-up*: a NAV markdown can leave a previously valid
level above the new NAV. D-025 answers that by pausing the ratchet rather than lowering the published
floor - a floor that can retreat is not a floor. The contract therefore exposes `isFloorCovered()`,
which goes false in exactly that situation, and a UI must stop presenting the level as backed when it
does. There is deliberately no setter for `floorTick`.

`AssetMarketManager.rebalanceToFloor(lower, upper)` repositions the market-floor **range** at or below
the published level: the highest price the range can reach must be at or below `floorPrice`. The check
is direction-aware, because with the asset as token1 a higher price is a lower tick. The range is
market inventory, not protected reserve (D-014), and the move still passes every normal safety gate
and the remove -> update -> remint lifecycle.

## 11. Pause and emergency matrix

| Component/action | While paused |
| --- | --- |
| Registry submission | Blocked |
| Token transfer/mint | Blocked |
| Authorized redemption burn | Allowed by token's narrow burn escape hatch |
| Vault initial deposit / primary credit / revenue deposit / redemption release / market withdrawal | Blocked where `whenNotPaused` applies |
| Vault return of market allocation | Allowed |
| Offering purchase | Blocked |
| Revenue deposit / holder claim | Blocked |
| Operator revenue claim | Allowed |
| Redemption request | Blocked at controller |
| Market funding / token funding / add liquidity / swap | Blocked |
| Market remove liquidity / collect fees / return idle mUSD | Allowed to keeper |
| Range rebalances | Rejected by market safety state |

Pausing separate components can produce different system behavior. An incident runbook must specify
which contracts to pause and in what order.

## 12. Implemented invariants

Stateful tests assert:

```text
token.totalSupply <= token.maximumSupply
revenue.excludedSupply <= token.totalSupply
revenue.yieldEligibleSupply = totalSupply - excludedSupply
token.investorSupply = totalSupply - token.issuerAllocationSupply
vault stablecoin balance >= vault.totalAccounted
vault.isSolvent = true across handler actions
revenue.totalClaimed <= revenue.totalHolderRevenue
redemptionReserve >= minimumRequiredReserve
redemption.outstandingTokenObligations = token.investorSupply
backing never falls through a redemption (D-023/D-025 ratchet precondition)
floorController.floorPrice <= vault.currentBacking (while investorSupply > 0)
```

Additional unit/integration properties include unauthorized role rejection, transfer-aware revenue,
burn-before-pay redemption, reserve-category isolation, callback authentication, oracle gates,
slippage/deadline checks, and complete slide/sweep/discovery-remint paths.

## 13. Current versus target behavior

| Capability | Current implementation | Target direction |
| --- | --- | --- |
| Asset verification | Registry with role-controlled NAV/status | Production evidence workflow and oracle governance |
| Primary raise | Immediate purchase and mint | Escrow plus deterministic full/partial/failed settlement |
| Company vesting | Contract plus local-script deployment | Factory/settlement-created and automatically registered |
| Supply headroom | Mathematical remainder below cap | Governed issuance controller with disclosed tranche rules |
| Secondary market | Guarded manager plus mock pool | Canonical Uniswap V3 integration and keeper automation |
| Chart data | Static OHLC fixtures | Reorg-safe indexed canonical swaps |
| Revenue | Stablecoin distribution with exclusions | Legal/economic revenue integration and reporting |
| Lock and earn | Not implemented | Stablecoin rewards funded by realized revenue/fees |
| Surplus/floor accretion | Not implemented | Realized-value allocation with explicit accounting |
| Backend | None | API, indexer, OHLC, monitoring |

## 14. External dependencies and boundaries

- OpenZeppelin supplies token, access, pause, reentrancy, safe-transfer, math, and vesting primitives.
- The current pool/factory are test harnesses. They are not a Uniswap implementation.
- Metadata is URI/hash anchored but not fetched or permissioned by the contracts.
- Legal rights, custody, KYC/AML, sanctions, tax, fiat rails, and verifier evidence systems are out of
  scope for the current repository.
- The optional local Hikari source reference is outside this repository at
  `C:\Users\willi\Documents\works\ml\hikari\hikari-contract-v2\src\BasePriceAUSD.sol`. ArcReserve must
  remain buildable without it.

