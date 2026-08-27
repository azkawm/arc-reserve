# Design Rationale

> Why the decisions in `DECISIONS.md` were made, which alternatives lost, and what has actually
> been verified versus assumed. Read this before proposing to change a settled decision. If you
> still think a decision is wrong, open it in `docs/stacks/HANDOFF_LOG.md` — do not silently
> re-litigate it in code.

## 1. What the token is (D-001, D-023, D-024)

**Decided:** a secured revenue-participation note — tokenization of a cash-flow claim, not of title.

**Alternative: token = ownership of the asset.** Rejected because the agreed economics are
debt-like: investors get principal back through a sinking fund and the issuer keeps the residual
reserve. Owners don't get repaid by the operator, and they keep the residual. Mixing the two makes
the reserve/redemption design incoherent and would require an SPV, transfer restrictions on a
corporate register, and licensing that a hackathon cannot carry. An ownership product would drop
the sinking fund entirely — that is a different product, not a variant.

**Consequence:** copy says "participation", never "own a piece of the plant"; the security
interest lives in the legal pack and is mirrored onchain only as the default → emergency path.

## 2. Reserve capitalisation and the sinking fund (D-023)

**Decided:** 30% of the raise held back as reserve at settlement (65/30/5), issuer refills to 1.0
per investor token by maturity on a linear schedule, residual returns to the issuer.

**Alternative A: issuer deposits 100% cash upfront (1:1).** Rejected: the issuer raises no net
capital (swaps 100k of its own cash for 100k of investors' cash plus a revenue obligation). Only
rational if the goal is distribution rather than funding.

**Alternative B: issuer deposits 20–30% upfront, rest from the raise.** Workable, but gives the
issuer only ~45% of the raise as fresh capital and requires cash before fundraising. Kept as an
*optional first-loss deposit* rather than a requirement.

**Alternative C: reserve never returned to the issuer.** Rejected: makes the reserve a pure cost
the issuer must price in, which defeats the point. With residual return, the reserve is a deposit
(time-value cost only), which is the honest framing of a sinking fund.

**Why linear:** simplest to explain and lightest early, when the plant is ramping. Front-loaded
curves can be added as a policy variant because the schedule is stored as
`(startBacking, targetBacking, startTime, maturity)`.

**Why the schedule needs enforcement:** with realistic revenue (~8% of raise/yr) the 25% revenue
split alone reaches ~0.5 backing, not 1.0. Scheduled issuer contributions are the lever that
closes the gap; without freezing proceeds on shortfall the schedule is just a promise.

## 3. Revenue base (D-022)

**Decided:** contracted percentage of **gross** revenue.

**Alternative: share of profit.** Rejected: profit is issuer-controlled (opex, salaries,
related-party costs, depreciation) and hard to verify; gross revenue for a PPA asset is
kWh × tariff, verifiable from one invoice. Lenders take revenue waterfalls for the same reason. If
the issuer needs a profit-like economics, the lever is the *percentage*, not the base.

## 4. Market making and the floor (D-010, D-013, D-025)

**Decided:** the floor is a reference derived from the reserve, published as a tick that steps up
one tick spacing at a time; the market-floor *range* is a small liquidity position funded only by
the market allocation; the protocol never bids.

**Alternative: Hikari/Tapio-style protocol-owned floor that can absorb all supply.** Rejected
twice. First, it contradicts the business model ("not a guaranteed market bid"). Second, it would
require the market manager to deploy the *protected reserve* into a pool, making redemption and
the floor compete for the same money and re-opening the "market inventory = reserve" confusion
that rule 3 in `CLAUDE.md` forbids. What actually backs every token is `redeem()` against the
reserve, and arbitrage pulls the market price up to that floor without protocol bids.

**Why stepped and ratchet-only:** backing per investor token is non-decreasing while Active
(reserve leaves only via redemptions priced ≤ backing), so publishing a level ≤ backing is safe to
ratchet. Steps of one tick spacing (~0.6%) paced by a cooldown turn a large reserve inflow into a
predictable climb the ARC engine can follow within `maxTickShift`.

**Why one step per call:** avoids gaps after big deposits; keeps level-ups as regular market
events; matches the engine's rebalance cadence.

## 5. Compliance layer (D-021) and the pool

**Decided:** ERC-3643-shaped identity registry + modular compliance bolted onto `AssetToken`
(Option A), with the pool and market manager as *exempt infrastructure*.

**Alternative B: replace the token with a Hedera ATS bond diamond.** Deferred, not rejected: it
brings coupons/snapshots/documentation/regulation metadata but forces snapshot-based revenue (our
accumulator can't hook an ATS token), a second toolchain (Hardhat 0.8.28), ~100-facet deploys, and
a large upgrade trust surface (BLR owner can swap any facet). Option A closes the main gap
(transfer permissioning) in days and shares the read interface, so B later is a token swap. The
`AtsExternalKycList` adapter is the concrete bridge.

**Alternative C: Hedera end-to-end with the ATS SDK/web app.** Rejected: drops our frontend and
indexer plan and ties the product to one chain.

**Why per-leg exemption:** exempting the pool for *both* legs would let it pay unverified wallets.
Per-leg means a verified wallet can swap, an unverified one can neither receive from nor sell into
the pool — KYC enforced at the AMM boundary with the pool knowing nothing.

**Why burns skip the sender check:** an expired KYC claim must not trap principal. Freeze still
blocks everything; expiry blocks only new acquisitions and transfers.

**Why the SwapRouter needs no exemption but the position manager does:** V3's router pays the
pool from the payer via callback and never custodies tokens; the NFT position manager does.

## 6. Company tokens (D-024)

**Decided:** non-redeemable, excluded from the backing denominator.

**Why:** `redemptionPrice` used `totalSupply`, which included the 20k vesting tokens; once vested
the issuer could redeem them against the reserve — pulling its own deposit out the side door and
diluting investor backing. The company's exit is the market, not the reserve.

## 7. Term-sheet binding (D-026) and investor classes (D-028)

Binding the factory params to the verifier-approved hash costs one `keccak` and closes the
"approved X, deployed Y" hole. Retail is allowed because the registry already carries
`investorClass`; per-class caps are a small offering change and make the demo show class-gating
rather than pretend everyone is institutional.

## 8. Verifier (D-029)

**Decided for the demo:** ArcReserve-operated verifier key, labelled "demo verifier".
**Production path:** independent 2/3 multisig, ideally a third party, because ArcReserve verifying
assets it also markets is a conflict of interest. Documented, not deployed (D-027).

## 9. Hackathon scope vs quality (D-027)

Scope bounds *what*: testnets, mock stablecoin, no legal wrapper, one admin key per chain. It never
bounds *how well*. Judges should see a small system built to a production standard.

## 10. Verified vs assumed — read before relying on any of these

| Claim | Status |
| --- | --- |
| `AssetMarketManager.marketPrices()` returns 6-decimal mUSD per token (the `1e18` in `_stablePrice` cancels the asset's 18 decimals) | **Verified** by reading the code; a subagent's earlier "1e18 scale" claim was wrong |
| Backing per investor token is non-decreasing while Active | **Reasoned** from the vault's single reserve-exit path; must be added as an invariant test (contracts task 7) |
| ATS `IExternalKycList` is `getKycStatus(address) → {NOT_GRANTED, GRANTED}` | **Verified** from the ATS source on 2026-08-27 |
| ATS token facets have no Hedera precompile dependency; contracts compile for generic EVM | **Verified** from `hardhat.config.ts` and file search; mass-payout has an HTS association path that was *not* verified as a no-op on non-Hedera chains |
| Uniswap V3 factory address on Base Sepolia | **Not verified** — take from Uniswap's official deployment list before use |
| Hedera testnet EVM version (Shanghai vs Cancun support) | **Not verified** — check before pinning `evm_version` |
| `deployments/31337.json` addresses equal a fresh Anvil deploy | **Reasoned** (deterministic nonces from account #0); regenerate after any script change |
| Frontend contains no mojibake | **Verified** by byte scan on 2026-08-27 |
| `AssetFactory` retains `PAUSER_ROLE`/`KEEPER_ROLE` after handoff | **Verified** in `_handoffAdministration`; decision on renouncing is open (contracts parked item) |
