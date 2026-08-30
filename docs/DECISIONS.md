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

Status: **superseded by D-031 (2026-08-30).** There is no company token allocation. The primitives
below (`CompanyVestingWallet`, `setYieldExcluded`) still exist and yield exclusion is still used,
but nothing mints a company allocation. Kept for history and in case an allocation is reintroduced.

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

On partial success, investors receive purchased tokens. Under D-031 the company receives no tokens
at all - its consideration is cash (65% settlement proceeds) plus residual reserve at close. Unsold
investor allocation remains unminted headroom. The protected issuer reserve remains protected rather
than being partially refunded during successful settlement.

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

**Implemented 2026-08-30** (contracts task 3). `revenueByPeriod[periodId]` accumulates, the period
and report hash are carried on `RevenueDeposited`, and `setReportingPolicy` / `isReportingOverdue`
expose the cadence. The overdue flag is deliberately **non-gating**: a missing report is an offchain
covenant breach for the verifier to act on, not something that should freeze a live market. The
reserve shortfall (D-023) is what actually freezes issuer capital.

## D-023: Sinking-fund reserve with a linear schedule, reserve yield, and residual return

Status: accepted 2026-08-27. **Schedule and enforcement implemented 2026-08-30** (contracts task 2:
`AssetVault.ReserveSchedule`, `targetBackingAt`, `currentBacking`, `isBehindSchedule`,
`shortfallStartedAt`, `isInEnforcedShortfall`, `depositReserve`, the `withdrawIssuerProceeds` gate,
`test/unit/ReserveSchedule.t.sol`). **D-023 is now fully implemented** (contracts tasks 2-6). Supersedes the "issuer deposits 20–30% upfront" reading of the business model.

**Settlement split implemented 2026-08-30** (contracts task 6). `PrimaryOffering` splits 65/30/5;
with no seed capital a raise lands at exactly 0.30 backing, matching the schedule's start point.
Escrowed threshold settlement (D-007) remains the separate, later milestone.

**Residual return implemented 2026-08-30** (contracts task 5). Maturity redemption is capped at par
(`vault.maturityParValue()`) and closes at `assetMaturity + maturityWindowSeconds`; afterwards, at
`Closed`, the issuer may call `releaseResidualReserve()` for `reserve - investorSupply*min(NAV, par)`.
Only the excess moves, so remaining holders keep full par cover and an underfunded asset has no
residual at all. The par cap is what makes residual return meaningful - without it a holder would
redeem at full backing and the residual would always be zero.

**Reserve yield implemented 2026-08-30** (contracts task 4). `AssetVault.accrueReserveYield` under
`YIELD_SOURCE_ROLE` credits `redemptionReserve` while behind schedule and `issuerProceeds` once on
or ahead, with a conservative default: **no schedule configured also credits the reserve**, so a
forgotten schedule cannot silently route investor yield to the issuer. Funds are pulled from the
caller so classification is atomic; a rebasing-stable integration would instead classify unaccounted
surplus. `MockYieldSource` is the demo stand-in.

**Dynamic split implemented 2026-08-30** (contracts task 3). `RevenueDistributor` stores two split
variants and picks per deposit by reading `vault.isBehindSchedule()` live: 60/25/10/5 on schedule,
40/45/10/5 behind. Both are admin-settable within bounds (holders >= 30%, operator <= 15%, protocol
<= 10%, each totalling 100%), and the behind-schedule variant may never route less to the reserve or
more to holders than the on-schedule one - so the mechanism cannot be inverted into a way to pay the
operator more during distress.

**Implementation note (2026-08-30).** Shortfall start is *derived* rather than observed: the target
curve is monotonically increasing, so the crossing time is recovered by inverting the line from the
current backing. Enforcement consequently requires no prior `syncShortfall()` call, closing the hole
where an issuer lets a dormant asset drift behind and then claims a fresh grace window by being the
first to touch it. `syncShortfall()` remains as a permissionless, pause-tolerant way to publish
entry/exit events for indexers and the verifier. Redemption is deliberately not gated by a
shortfall — only issuer capital freezes.

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

Status: accepted 2026-08-27; **implemented 2026-08-27** (`AssetToken.setIssuerAllocation` /
`investorSupply()`, vault and redemption denominators, `test/unit/IssuerAllocation.t.sol`).

Tokens minted to the company vesting wallet (and any address flagged `issuerAllocation`) cannot
call `redeem()` in any mode. They remain transferable to verified buyers after vesting and earn
revenue only once released (D-005/D-006 unchanged). `investorSupply = totalSupply − issuerAllocation`
is the denominator for `targetBacking`, `redemptionPrice`, and the reserve ratio. This closes the
path where the issuer's own tokens drain the investors' reserve.

## D-025: Stepped, ratchet-only published floor ("level up")

Status: accepted 2026-08-27; **implemented 2026-08-30** (contracts task 7:
`src/market/FloorController.sol`, `AssetMarketManager.rebalanceToFloor`,
`test/unit/FloorController.t.sol`, plus a seventh invariant).

**Implementation note.** The ceiling is re-derived on every `levelUp()` rather than trusting the
stored level, so the ratchet is correct by construction. One asymmetry had to be resolved and is
worth knowing: `floorPrice <= backing` holds permanently (backing never falls while Active), but
`floorPrice <= NAV` is only guaranteed at the moment of each level-up - a NAV markdown can leave a
valid level above the new NAV. Lowering the floor would defeat the ratchet, so the contract keeps the
level and exposes `isFloorCovered()`, which goes false in exactly that case. Publishing an uncovered
floor silently would be the D-010 failure this decision exists to avoid; reporting it is the honest
handling. There is deliberately no setter for `floorTick`.

The optional best-effort `levelUp` attempts from reserve-crediting paths were **not** implemented:
they would couple money-moving vault functions to a non-essential contract, and a permissionless
`levelUp` plus a keeper achieves the same pacing with strictly less risk. Resolves the "no equivalent to Hikari bump"
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

Status: accepted 2026-08-27; **implemented 2026-08-30** (contracts task 8:
`AssetRegistry.approveAsset(assetId, initialNAV, termsHash)` / `reapproveTerms` / `termsHashOf`,
`AssetFactory` `TermsMismatch()` gate, `test/unit/TermSheetBinding.t.sol`).

**Two implementation choices worth recording.** A zero `termsHash` is rejected rather than treated as
"unbound" - an unbound approval would let any parameters through, which is the exact hole this
decision closes. And `reapproveTerms` is restricted to the `Approved` state: once the system is
deployed the stored hash describes what actually exists, and letting it drift would make
`termsHashOf` unreliable. A post-deployment amendment is an offchain legal event, not an onchain
rebinding. The gate is checked before structural parameter validation, so nothing unapproved reaches
the rest of the factory.

`approveAsset(assetId, initialNAV, termsHash)` records the hash of the term sheet the verifier
committee approved. `AssetFactory.deployAssetSystem(params)` requires
`keccak256(abi.encode(params)) == termsHash` and reverts with `TermsMismatch()` otherwise. The
`DeploymentParams` struct is therefore the canonical term sheet; the offchain legal pack references
the same hash. Amending terms after approval requires `reapproveTerms(assetId, newTermsHash)` by the
verifier (and, in the institutional flow, restarts the approval time-lock). Closes the
"approved X, deployed Y" hole at near-zero cost.

## D-027: Hackathon scope and testnet-only deployment targets

Status: accepted 2026-08-27; governs every other decision.

ArcReserve is a **hackathon submission**. Deployment targets are local Anvil (31337),
**Base Sepolia (84532)**, and **Hedera testnet (296)**. There is no mainnet target, no real
stablecoin (`MockUSD` everywhere), no real investors, and no audit. Institution-grade mechanisms
(D-021 compliance, D-023 schedule, D-026 term-sheet binding, the user flows) are demonstrated on
testnet as design proof, not offered as regulated services.

Consequences for each stack:

- **Contracts**: `deployments/<chainId>.json` per target (`31337`, `84532`, `296`); a deploy
  script that takes the chain from `block.chainid`; on Base Sepolia the canonical Uniswap V3
  factory may be used (address must be verified from Uniswap's deployment list before use), on
  Hedera testnet the mock pool is used unless a V3-compatible DEX factory is verified; pin
  `evm_version` to one both chains support (verify Hedera's current EVM version before choosing
  Shanghai/Cancun); Hedera calls go through the JSON-RPC relay (`https://testnet.hashio.io/api`).
- **Backend**: `CHAIN_ID` per deployment; three registry addresses in config; Hedera history may
  also be read from the mirror node but the viem indexer remains the source of truth for parity.
- **Frontend**: wagmi `chains: [anvil, baseSepolia, hederaTestnet]`, chain-switch prompt, a
  visible **"Testnet demo — no real funds"** banner on every route, and no copy that implies a
  live offering.
- **Keys**: Anvil keys never leave Anvil; testnet deployer keys in untracked `.env` only; one
  admin key per chain is acceptable for the demo.

## D-028: Investor classes — retail allowed, class-based purchase caps

Status: accepted 2026-08-27; **implemented 2026-08-30** (contracts task 9:
`PrimaryOffering.setClassLimit` / `classLimits` / `raisedByClass` / `investorClassOf` /
`effectiveWalletLimit` / `remainingAllowance`, `test/unit/ClassPurchaseCaps.t.sol`).

**Implementation note.** A configured class limit *replaces* the global `walletPurchaseLimit` rather
than stacking with it — the decision says "falling back to `walletPurchaseLimit`", and stacking would
cap an institution at the retail-era global figure. `type(uint256).max` expresses "uncapped within the
fundraising cap", which still bounds everyone.

Demo wiring changed the seeded identities so both ends of the range are demonstrable: the deployer is
institutional, Anvil #1 (the main demo investor) is **accredited** so its 50,000 headroom is
unchanged, and Anvil #2 is registered as **retail** purely to show the 5,000 cap bite.

The demo admits retail investors. `IdentityRegistry.investorClass` is the source of truth:
`1 retail`, `2 accredited`, `3 institutional`. `PrimaryOffering` gains per-class wallet purchase
limits (`walletPurchaseLimitByClass[class]`, falling back to `walletPurchaseLimit`) and a
per-class aggregate cap where the term sheet requires one (e.g. a maximum share of the raise from
retail). Demo values: retail 5,000 mUSD, accredited 50,000 mUSD, institutional uncapped within the
fundraising cap. The verifier UI and asset page display the class of the connected wallet and its
remaining limit. Suitability acknowledgements are recorded offchain by hash at subscription
(target, with the escrow milestone). In line with D-027 this is a demonstration of class-gating,
not a licensed retail offering.

## D-029: Verifier is ArcReserve-operated for the demo; independent multisig is the production path

Status: accepted 2026-08-27 (owner delegated to the default).

For the testnet demo the `VERIFIER_ROLE` is held by an ArcReserve-operated key and every verifier
surface is labelled "demo verifier". The documented production path is an independent 2/3 multisig
(ideally a third-party verification firm) because ArcReserve verifying assets it also markets is a
conflict of interest. `docs/USER_FLOWS.md` §1 and `docs/SECURITY.md` carry both.

## D-030: Backend persistence, migrations, and multi-chain topology

Status: accepted 2026-08-27 (owner delegated to the default). Closes open item 9.

PostgreSQL 16 with **plain-SQL migrations run by `node-pg-migrate`**. No ORM: the read model is
built from exact `NUMERIC` base units and hand-written SQL, and an ORM between the projector and
the ledger would obscure the rounding and constraint behaviour that has to match Solidity exactly.
Validation is Zod, at both the configuration boundary and the response boundary. A bundled
`docker-compose.yml` provides the database on `127.0.0.1:5450`; no managed provider is used for a
hackathon that must run on a laptop.

**Topology.** One database serves all three chains, with `chain_id` on every row and in every
primary key. One indexer **process** per chain, configured by the documented single-chain
environment block; the API process serves every chain present in the database. This keeps a slow
or failing Hedera relay from stalling Anvil and Base Sepolia, while a single database keeps
cross-chain queries and one migration history.

**Storage guarantees.** Financial columns use `uint256` / `int256` domains defined as unconstrained
`NUMERIC` with `SCALE(VALUE) = 0` and explicit range checks — deliberately *not* `NUMERIC(78,0)`,
whose typmod is applied before the domain check and would silently round `1.5` to `2` instead of
rejecting it. A `chains_testnet_only` CHECK constraint refuses a mainnet chain id at the storage
layer as well as in configuration (D-027).

## D-031: The issuer receives no token allocation

Status: accepted 2026-08-30 (owner). Supersedes D-005 and amends D-008.

**Decision.** No company/issuer token allocation exists. The issuer's consideration is cash only:
65% of settlement proceeds (D-023), the operator share of revenue, and the residual reserve released
at `Closed`. All minted tokens are investor tokens.

**Why.** SOLAR01 is a secured revenue-participation note, not equity (D-001, D-023). Three concrete
problems with an issuer allocation:

1. *Circular economics.* The issuer deposits a contracted share of gross revenue (D-022) and would
   then receive part of it back as a holder. At the previous 20,000/100,000 demo split the issuer
   collected 20% of the holder pool, diluting real investors' revenue share by the same 20%.
2. *It required defensive machinery.* D-024 (non-redeemable, excluded from the backing denominator)
   exists only to stop the issuer's own tokens draining the investors' reserve.
3. *It broke the floor ratchet.* Moving tokens between `issuerAllocationSupply` and `investorSupply`
   makes backing per token fall, contradicting the non-decreasing-backing assumption D-025 relies on.

Issuer alignment is provided instead by the D-023 first-loss reserve deposit and the enforced
sinking-fund schedule, which are the right instruments for a debt-shaped claim.

**Consequences.**

- `DeployLocal` no longer creates or funds a `CompanyVestingWallet`; the `companyVesting` key is
  removed from `deployments/<chainId>.json`.
- Supply story: 100,000 authorized, 80,000 offering inventory, **20,000 unminted headroom** (D-002,
  D-004). The cap is unchanged; the 20,000 is simply never minted.
- D-024's `issuerAllocation` flag, `investorSupply()` and the redemption block are **retained** as a
  general-purpose guard and stay tested, but nothing sets the flag in the demo, so
  `investorSupply == totalSupply` throughout.
- D-006 yield exclusion is unaffected and still used for any excluded address.
- Frontend copy claiming a 20% company vesting allocation must be removed (announced in
  `CONTRACTS_TO_FRONTEND.md`).

**Open sub-question:** whether to delete `src/vesting/CompanyVestingWallet.sol` outright. It is
currently unused by the demo but still referenced by a yield-exclusion test. Left in place pending
owner confirmation.

## D-032: The factory renounces every role it receives, not just the admin role

Status: accepted and implemented 2026-08-30 (contracts task 10, `AssetFactory._handoffAdministration`,
`test/unit/FactoryRoleHygiene.t.sol`).

**The finding.** `AssetFactory` is passed as `admin` to every component constructor so it can wire
them. Those constructors grant the admin more than `DEFAULT_ADMIN_ROLE`: also `PAUSER_ROLE` on all
six, `KEEPER_ROLE` on the redemption controller and market manager, and `REVENUE_DEPOSITOR_ROLE` on
the distributor. The handoff renounced only `DEFAULT_ADMIN_ROLE`, so **the factory permanently held
pauser on every component of every series it had ever deployed**, plus keeper on two of them.

Not exploitable today - the factory has no function that calls into those roles - but it is a
standing privilege with no purpose and a very large blast radius, and it is exactly what a reviewer
looking at role holders would flag first in a system that calls itself institution-grade.

**Decision.** The factory renounces every role it holds, admin last because the grants to the
protocol admin need it. `FactoryRoleHygiene.t.sol` asserts two things: the factory ends up holding
nothing on any component, and nothing it gave up was left without a holder.

## Open decisions

The following require explicit owner input before implementation:

0. ~~**D-024 vs D-025: a vesting sale lowers backing per token.**~~ **Resolved 2026-08-30 by D-031.**
   With no issuer allocation, nothing is ever flagged, `investorSupply == totalSupply`, and backing
   is non-decreasing while Active as D-025 assumes. The hazard would return if an allocation were
   reintroduced, so `levelUp()` should still re-check `price(level) <= min(NAV, backing)` on every
   call rather than trusting a cached level - cheap, and it makes the ratchet correct by
   construction instead of by assumption. Task 7 is unblocked.

1. Final authorized-supply allocation among offering, company vesting, market inventory, and headroom.
2. Whether the issuer can reject an eligible partial settlement.
3. Asset-specific reserve ratios and post-settlement reserve requirements.
4. Follow-on issuance approval, TWAP window, auction rules, and proceeds allocation.
5. Realized market-surplus split.
6. Lock duration, minimum free float, early exit, and redemption treatment.
7. Stablecoin, fee schedule, refund deadline, early close, and oversubscription policy.
8. Legal rights, jurisdiction, custody, KYC/AML, sanctions, tax, and investor eligibility.
9. ~~Backend database/deployment provider and target testnet.~~ Settled by D-030 (PostgreSQL 16 +
   `node-pg-migrate`, one database, one indexer process per chain) and D-027 (all three testnets).
10. Whether the production chart will use TradingView Lightweight Charts or retain another library.

