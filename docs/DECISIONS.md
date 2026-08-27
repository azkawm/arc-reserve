# ArcReserve Decision Log

This file records accepted product and engineering decisions so later agents do not reopen settled
questions accidentally. It is not a substitute for contract code. Each entry states whether it is
already implemented or remains target policy.

## D-001: Use careful asset-participation language

Status: accepted and implemented in core product copy.

ArcReserve tokens are described as **asset participation tokens**. The protocol must not imply that
the ERC-20 automatically conveys equity, legal title, a share certificate, guaranteed income, or a
guaranteed claim on the underlying property. Any such right must come from external legal documents.

## D-002: Every asset series has an immutable authorized cap

Status: implemented.

`AssetToken.maximumSupply` is immutable and minting above it reverts. The product must never describe
SOLAR01 as unlimited supply.

The cap does not require all tokens to be minted at launch. Unminted capacity may be described as
issuance headroom, but it is not supply, backing, company inventory, or holder property.

## D-003: The market manager never receives mint authority

Status: implemented.

Market participation during seller scarcity must not be solved with an unrestricted market-maker
mint. The manager may use existing market inventory only. Future headroom issuance must be a separate,
governed, disclosed process that remains within the cap.

## D-004: Seller scarcity is handled in a defined order

Status: accepted target policy.

The intended sequence is:

1. existing secondary-market inventory;
2. scheduled releases from disclosed company vesting;
3. controlled issuance from remaining authorized headroom; and
4. a newly verified tranche or series after headroom is exhausted.

The current repository implements steps 1 and a demo form of step 2. It does not implement a governed
controller for step 3 or a tranche factory policy for step 4.

## D-005: Company allocation is vested and excluded from holder yield

Status: partially implemented.

The company allocation must go to a vesting contract and must not dilute the yield denominator while
locked. Released tokens become eligible only for future deposits.

`CompanyVestingWallet` and `RevenueDistributor.setYieldExcluded` implement the primitives. The local
deployment script wires a 20,000-token, one-year example. Generic factory/settlement wiring remains
future work.

## D-006: Yield is calculated from eligible circulating supply

Status: implemented.

```text
eligible circulating supply = issued supply - yield-excluded balances
```

Unminted headroom never enters the denominator. Vested tokens remain part of issued supply and reserve
obligations even while excluded from yield.

## D-007: Target offering outcomes use a strict partial-success threshold

Status: target policy, not implemented.

Proposed settlement outcomes:

- 100% or more: full success;
- strictly more than 50% and less than 100%: partial success; and
- 50% or less: failed raise and investor refund.

Exactly 50% is failure under the current specification. The threshold should be configurable when
implemented. Partial settlement should include an explicit issuer acceptance step.

## D-008: Partial settlement does not turn unsold investor tokens into company inventory

Status: accepted target policy.

On partial success, investors receive purchased tokens and the company receives only its previously
disclosed vested allocation. Unsold investor allocation remains unminted headroom. The protected
issuer reserve remains protected rather than being partially refunded during successful settlement.

## D-009: Separate five value concepts in product and code

Status: implemented in contracts; partially implemented in UI data sourcing.

The following are never interchangeable:

1. pool spot;
2. pool TWAP;
3. verified NAV;
4. protected floor reference; and
5. redemption price.

The frontend may display them together for comparison but must label provenance and timestamps.

## D-010: The protected floor is a reference, not a peg

Status: accepted and partially implemented.

The normal backing-aware reference is:

```text
min(verified NAV per token, liquid redemption reserve / issued supply)
```

It is not a guaranteed market bid, guaranteed principal, or unconditional redemption promise.

## D-011: Price appreciation is not a dividend

Status: accepted.

Unrealized market appreciation cannot be distributed. Only realized asset revenue, realized market
fees, realized rebalance surplus, or completed issuance proceeds may be allocated.

Moving realized surplus into protected reserve is called **floor accretion**. A distribution should
be called a dividend only if the legal instrument actually establishes a dividend.

## D-012: Lock-and-earn rewards use realized stablecoin value

Status: target only.

Lock rewards should be paid in mUSD or another realized revenue asset, not newly minted SOLAR01.
Locked tokens still count toward supply and backing obligations. Incentives should reduce or stop when
free float falls below the selected minimum, initially suggested at 20%.

## D-013: Hikari informs the market lifecycle, not the economic model

Status: implemented as design guidance and tests.

The external Hikari `BasePriceAUSD.sol` inspired `slide`, `sweep`, and discovery refresh UX. ArcReserve
does not copy its bonding curve, automatic token minting, or automatic floor borrowing. The current
manager keeps issuance and protected reserve outside the market strategy.

## D-014: Liquidity is shown and managed per position

Status: implemented in manager records and UI fixtures.

The market view should show market-floor, anchor, discovery, and optional intermediary liquidity
separately. The protected redemption reserve must not be included in any position balance.

## D-015: Range updates use explicit remove, update, and remint

Status: implemented.

For the MVP, active liquidity must be removed before its range changes. A successful range update does
not automatically remint. This creates an observable, keeper-controlled lifecycle and a temporary
liquidity gap. Atomic rebalance execution is deferred until production AMM integration is designed.

## D-016: A paused market must still be recoverable

Status: implemented and tested.

Pause stops new market funding, token inventory funding, liquidity addition, swaps, and rebalances.
Authorized liquidity removal, fee collection, and return of idle mUSD remain available so assets are
not trapped during an incident.

## D-017: Use candlesticks and show the protected floor

Status: implemented as a frontend fixture.

The asset chart uses candle-shaped OHLC bars with TWAP, NAV, and protected-floor overlays. It currently
uses Recharts and static data. It is not TradingView Lightweight Charts and is not fed by an indexer.

## D-018: Add a backend, indexer, and OHLC service

Status: accepted next subsystem, not implemented.

The backend should index contract and canonical-pool events, store reorg-safe history, expose derived
asset and accounting views, and aggregate swap prices into OHLC intervals. See `BACKEND_INDEXER.md`.

## D-019: Mock and live data must never be silently mixed

Status: accepted; frontend migration required.

Every API/UI value should carry or imply clear provenance: onchain raw, backend-derived, or explicit
demo fixture. A failed live query must show stale/error state rather than silently displaying a mock
number as current.

## D-020: Hackathon rigor focuses on financial boundaries

Status: implemented in the test strategy.

The suite prioritizes cap enforcement, accounting separation, revenue ownership, redemption ordering,
oracle and reserve gates, callback authentication, role control, emergency recovery, and full market
happy paths. Production economic simulation, fork tests, formal verification, and exhaustive fuzzing
remain pre-production work.

## D-021: The token is permissioned through an ERC-3643-shaped compliance layer

Status: implemented on 2026-08-27 (`contracts/src/compliance/`, `AssetToken`).

Decision (owner, 2026-08-27): adopt **Option A** from `docs/stacks/ATS_INTEGRATION.md` — keep the
ArcReserve contracts and add transfer permissioning that uses the same interface shape as T-REX /
Hedera ATS, on a generic EVM chain. Full ATS token replacement (Option B) stays a roadmap item.

Rules:

- A protocol-wide `IdentityRegistry` binds wallets to a verified identity (jurisdiction, investor
  class, claim expiry). A KYC provider holding `REGISTRY_AGENT_ROLE` maintains it. No personal data
  is stored onchain.
- `AssetToken` checks both legs of every transfer: frozen addresses, partial freezes, identity
  verification, then per-token `ModularCompliance` modules. `transferRestriction()` exposes the first
  failing rule for UI previews.
- **Infrastructure is exempt, investors are not.** The canonical pool, the market manager, and the
  company vesting wallet are `complianceExempt`; their counterparty leg is still enforced. This is
  what lets a Uniswap V3 pool sit inside the perimeter: a verified wallet may swap with it, an
  unverified wallet can neither receive from it nor sell into it.
- A burn (redemption exit) never fails on a stale or deleted KYC claim. Investor principal is not
  trapped by an expired credential; only new acquisitions and secondary transfers are.
- `TRANSFER_AGENT_ROLE` may freeze addresses or balances and execute `forcedTransfer` to a verified
  recipient (legal orders, wallet recovery).
- Modules shipped: `CountryAllowModule` (recipient jurisdiction allow-list) and `TransferLockModule`
  (resale hold period after primary issuance; burns always allowed).
- `adapters/AtsExternalKycList` exposes the registry as an ATS `IExternalKycList`
  (`getKycStatus`), so ATS-issued securities can reuse the same KYC decisions.

Consequences: the factory requires a non-zero `identityRegistry`; secondary AMM trading of SOLAR01
is limited to verified wallets by construction; any router or position manager that *holds* tokens
transiently must be exempted or verified (the Uniswap V3 `SwapRouter` does not hold tokens, the
`NonfungiblePositionManager` does).

## D-022: Revenue base is a contracted share of gross revenue

Status: accepted 2026-08-27; target contract change.

The issuer's periodic deposit is a **term-sheet percentage of gross asset revenue** (demo: 40%),
not a share of profit. Gross revenue (e.g. kWh × PPA tariff) is externally verifiable and cannot be
reduced by issuer-controlled costs; profit can. The deposited amount is then split by the
distributor (60% yield-eligible holders / 25% protected reserve / 10% operator / 5% protocol, or
the dynamic split in D-023). The issuer keeps the remaining gross revenue to operate the asset.

Contract implications: `depositRevenue(amount, periodId, reportHash)` records the reporting period
and the hash of the revenue report; a period without a deposit past its grace window is a
reporting shortfall (see D-023 enforcement).

## D-023: Sinking-fund reserve with a linear schedule, reserve yield, and residual return

Status: accepted 2026-08-27; target contract change. Supersedes the "issuer deposits 20–30% upfront"
reading of the business model.

**Instrument.** SOLAR01 is a secured revenue-participation note, not ownership (D-001 stands).

**Capitalisation at settlement.** Proceeds split 65% issuer proceeds / 30% protected reserve /
5% market allocation. An issuer cash deposit is optional, first-loss, and returned last.

**Schedule.** `targetBacking(t)` rises linearly from the backing at settlement to `1.0` (one mUSD
per investor-held token) at maturity. Stored as `(startBacking, targetBacking, startTime, maturity)`
so a front-loaded curve can be added as a policy variant without changing enforcement.

**Reserve growth sources** (all credited to `redemptionReserve`): the 30% settlement holdback;
scheduled issuer contributions (`depositReserve`); 25% of every revenue deposit, rising to 45%
(holders 40%) while backing is below schedule; reserve yield; realised market surplus (never
budgeted). Redemptions at `price ≤ reserve/supply` raise backing for remaining holders.

**Reserve yield.** The reserve may be held in a yield-bearing stable. Yield accrues to the reserve
while backing is below `targetBacking(now)`, and to the issuer once on or ahead of schedule.

**Enforcement.** If `reserve / investorSupply < targetBacking(now)` for longer than the grace
period (demo: 30 days), the asset enters `ReserveShortfall`: issuer proceeds withdrawal and headroom
issuance are blocked, the state is surfaced to the verifier and UI, and 90 days of shortfall is a
default trigger for the verifier committee.

**Exit.** Any time: `min(NAV, reserve / investorSupply)`, period-limited. At maturity: up to
`min(NAV, 1.0)` during the maturity window. Residual reserve above outstanding obligations after
the window is released to the issuer at `Closed` (`releaseResidualReserve`).

**Value mechanics (for copy).** Reserve growth raises the floor and pulls the market price up by
arbitrage; it never bids on the market. Market depth comes from the 5% market allocation, fees, and
the ARC engine, whose ranges follow the floor.

## D-024: Company tokens are non-redeemable and excluded from the backing target

Status: accepted 2026-08-27; target contract change.

Tokens minted to the company vesting wallet (and any address flagged `issuerAllocation`) cannot
call `redeem()` in any mode. They remain transferable to verified buyers after vesting and earn
revenue only once released (D-005/D-006 unchanged). `investorSupply = totalSupply − issuerAllocation`
is the denominator for `targetBacking`, `redemptionPrice`, and the reserve ratio. This closes the
path where the issuer's own tokens drain the investors' reserve.

## D-025: Stepped, ratchet-only published floor ("level up")

Status: accepted 2026-08-27; target contract change. Resolves the "no equivalent to Hikari bump"
gap in `MARKET_MAKING.md` without minting or reserve borrowing.

**Invariant relied on.** While an asset is Active, `redemptionReserve / investorSupply` is
non-decreasing: the reserve leaves only through redemptions priced at `≤ reserve/supply`, and each
such redemption raises backing for remaining holders (must be added to the invariant suite).

**Mechanics.** The floor level is a pool tick, and each level-up moves it by exactly **one
`tickSpacing`** of the canonical pool (demo: 60 ticks ≈ +0.6% per step; 0.30 → 1.00 ≈ 200 steps).
```
backing      = redemptionReserve / investorSupply                       (6d mUSD per token)
floorTick    = published level; price(floorTick) = 1.0001^tick adjusted for token order
levelUp()    = permissionless; advances floorTick by one tickSpacing in the price-up direction
               iff price(next tick) ≤ min(NAV, backing) and floorLevelCooldown has elapsed
               (demo: 30 min, shared with the rebalance cooldown). One step per call, so a large
               reserve inflow becomes a paced climb rather than a gap.
```
`levelUp()` may also be attempted (not required) inside `depositReserve` / `depositRevenue` /
`accrueReserveYield` / headroom-issuance settlement. Emits `FloorLevelUp(previousTick, newTick,
floorPrice, backing, nav)`. Direction is resolved with `assetIsToken0` exactly as the market
manager does (asset = token0 → higher tick is higher price; otherwise the reverse).

**What the level drives.** The published protected-floor reference in every UI surface; the ARC
engine's market-floor range, repositioned just below the new level by a keeper `rebalanceToFloor`
(subject to the existing safety gates and remove→update→remint lifecycle). It does **not** change
`redeem()`, which keeps paying the continuous `min(NAV, backing)` (always ≥ the level).

**Sources counted.** Everything credited to the reserve: settlement holdback, sinking-fund
contributions, the 25–45% revenue split, reserve yield, headroom issuance sold above par, and
realised ARC surplus returned to the vault. Unrealised price appreciation is never counted (D-011).

**Guard rails.** The level is capped by NAV, so a NAV markdown pauses level-ups instead of
publishing an unbacked floor. The ratchet applies only in Active; in Suspended/Defaulted the
published reference is the emergency settlement price. A floor level is a reference, not a bid
(D-010 unchanged).

## D-026: Deployment parameters are bound to the verifier-approved term sheet

Status: accepted 2026-08-27; target contract change.

`approveAsset(assetId, initialNAV, termsHash)` records the hash of the term sheet the verifier
committee approved. `AssetFactory.deployAssetSystem(params)` requires
`keccak256(abi.encode(params)) == termsHash` and reverts with `TermsMismatch()` otherwise. The
`DeploymentParams` struct is therefore the canonical term sheet; the offchain legal pack references
the same hash. Amending terms after approval requires `reapproveTerms(assetId, newTermsHash)` by the
verifier (and, in the institutional flow, restarts the approval time-lock). Closes the
"approved X, deployed Y" hole at near-zero cost.

## Open decisions

The following require explicit owner input before implementation:

1. Final authorized-supply allocation among offering, company vesting, market inventory, and headroom.
2. Whether the issuer can reject an eligible partial settlement.
3. Asset-specific reserve ratios and post-settlement reserve requirements.
4. Follow-on issuance approval, TWAP window, auction rules, and proceeds allocation.
5. Realized market-surplus split.
6. Lock duration, minimum free float, early exit, and redemption treatment.
7. Stablecoin, fee schedule, refund deadline, early close, and oversubscription policy.
8. Legal rights, jurisdiction, custody, KYC/AML, sanctions, tax, and investor eligibility.
9. Backend database/deployment provider and target testnet.
10. Whether the production chart will use TradingView Lightweight Charts or retain another library.

