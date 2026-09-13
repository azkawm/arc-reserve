# ArcReserve product knowledge

Owner: **Contracts session (Contract Arch)**. Read first in [`README.md`](README.md)'s order.
Grounded in the owner's Stitch launchpad design (`design/stitch_arcreserve_rwa_launchpad_portal.zip`)
and checked against `contracts/src`, the two live testnets, and the frontend source on 2026-09-13.
Nothing here is committed until the owner reviews it.

This document answers one question per screen element: **what does it mean on chain, and is it
enforced?** Which API supplies each number is [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md)'s job;
this file never restates endpoints. Keys are `<stitch folder>#<element>` so the two documents join.

Status vocabulary, exactly as the README defines it:

- **LIVE** — enforced on chain. Contract, function and event named.
- **DERIVED** — computed by the backend from chain data. The source data is named here.
- **NOT IMPLEMENTED** — a target or preview. Nothing enforces it; the UI must label it (`CLAUDE.md`
  rule 10), or remove it.

A fourth marker is used where the design states something the contracts **contradict**:
**WRONG** — the element must change, not merely be labelled. A label cannot fix a false claim.

---

## 1. Where the truth lives

| | Hedera testnet | Circle Arc testnet | Base Sepolia |
|---|---|---|---|
| chainId | **296** | **5042002** | 84532 |
| Status | live, indexed | live, indexed | parked (deployed, not seeded, not indexed) |
| Addresses | `contracts/deployments/296.json` | `contracts/deployments/5042002.json` | `contracts/deployments/84532.json` |
| Pool | real Uniswap V3 we deployed | real Uniswap V3 we deployed | canonical Uniswap V3 |
| `assetIsToken0` | true | true | false |
| Native gas | HBAR | **USDC, 18 decimals at the EVM level** | ETH |

**Key every address by `(chainId, address)`, never by address alone.** One deployer key produced the
same address for different contracts on different chains: `0xECEbb2dA…` is the **AssetFactory** on
Arc and the **AssetRegistry** on Hedera. A config or fixture that carries an address without its chain
points at the wrong contract type and fails with wrong reads, not a revert.

Live state on both chains, verified on chain 2026-09-13 (same build, same seeded state):

| Read | Value |
|---|---|
| `AssetRegistry.statusOf(assetId)` | 2 = Active |
| `AssetToken.totalSupply()` | 5,000 SOLAR01 |
| `AssetVault.redemptionReserve()` | 21,799.999998 mUSD |
| `AssetVault.currentBacking()` | 4.359999 mUSD per token |
| `AssetRegistry.navOf(assetId)` | 1.000000 mUSD |
| `RedemptionController.redemptionPrice(Normal)` (Hedera read) | **1.000000 — NAV is the binding term** |
| Market spot (after one demo swap) | ≈1.0946 mUSD (tick −275420) |
| `pool.liquidity()` | 1e16 (re-armed 2026-09-13 by `ArmMarket`, §7.7) |
| Anchor position | ticks −275760..−275160 (≈1.0580–1.1234 mUSD), L = 1e16, funded both sides |
| Discovery position | ticks −275160..−273960 (≈1.1234–1.2667 mUSD), L = 1e16, asset only. **The first swap harvests it** |
| Reserve-floor position | L = 0 |
| `principalOutstanding` / `creditableSurplus` | 250 mUSD / 0. The manager is under water by design: small trades credit nothing, and one buy ≥ ~314 mUSD does (§7.7) |

Every figure in the Stitch screens (NAV 1.12, floor 0.38, $84,500 raised of $100,000, 14.8% APR…) is
illustrative. None of them is live.

---

## 2. Product rules a designer or judge gets wrong

1. **SOLAR01 is a secured revenue-participation note, not ownership, equity or a stablecoin.** No
   screen may say "equity", "shares", "guaranteed return" or "peg".
2. **Primary split is 65 / 30 / 5, fixed in code.** `PrimaryOffering.buy` routes each purchase to the
   vault and calls `AssetVault.recordPrimaryProceeds`: 65% `issuerProceeds`, 30% `redemptionReserve`,
   5% `marketMakingAllocation`. The 65% is **not wired to the issuer**. It accrues in the vault, and
   the issuer calls `withdrawIssuerProceeds`, which reverts `ReserveShortfallActive` during an
   enforced shortfall. The 5% is **not placed in the pool automatically**. A keeper draws it with
   `fundFromVault` and deploys it with `addLiquidity`.
3. **Revenue split is 60 / 25 / 10 / 5 on schedule and 40 / 45 / 10 / 5 behind schedule**
   (holders / reserve / operator / protocol). `RevenueDistributor.depositRevenue` picks the split
   from `AssetVault.isBehindSchedule()` **at the moment of deposit**. There is no 30-day delay and no
   "solvency below 95%" trigger. The 30-day grace applies to something else:
   `isInEnforcedShortfall()`, which blocks issuer withdrawals and nothing more.
4. **Backing is a linear sinking-fund schedule from 0.30 to 1.00 mUSD per token** over the 3-year
   term (`AssetVault.setReserveSchedule`, `targetBackingAt`). This is **backing**, not the floor, and
   not a price anyone can trade at.
5. **There are four distinct prices, and they must never be collapsed** (`CLAUDE.md` rule 4):
   - **NAV** is published by the verifier (`AssetRegistry.publishNAV`, `navOf`), moves at most 20%
     per update, and is stale after 2 days.
   - **Spot** is the Uniswap pool price (`AssetMarketManager.marketPrices` spot, from `slot0`).
   - **Floor** is the published reference `FloorController.floorPrice()`. It is **not a bid** and
     changes nothing any wallet is paid.
   - **Redemption price** is `RedemptionController.redemptionPrice(mode)`.
6. **Redemption pays `min(NAV, liquid backing per token)`.** In `Normal` mode there is **no par cap**;
   par applies only in `Maturity` mode. Today backing is 4.36× NAV, so NAV binds, and a stale or
   wrong NAV prices redemptions directly, in both directions. A NAV that is wrong upward pays out of
   the shared reserve (`docs/SECURITY.md`). **Redemption never pays the floor price.**
7. **NAV gates nothing in the market engine (D-039).** A stale NAV does not stop trading, liquidity
   or rebalancing.
8. **There is no TWAP (D-036).** Spot is the instantaneous pool price. "Weighted average" is wrong.
9. **The user trade path is `AssetMarketManager.swapExactInput` (D-037).** Approve the **market
   manager**, never the pool or a router. The event carries `amountRequested` and `amountSpent`; show
   `amountSpent`. A partial fill refunds the unspent input. The pool pays the caller directly, so
   **a wallet buying SOLAR01 must be KYC-verified**.
10. **The floor ratchets one pool tick spacing per `levelUp()`** (60 ticks, ≈0.6%). The ratchet is
    permissionless, rate-limited by a cooldown (5 seconds on the testnets), and capped so the next
    level never exceeds `min(NAV, backing)` (`FloorCeilingExceeded`). It is not "+$0.010 per 30 days".
    It starts at ≈0.2983 mUSD. Swaps and rebalances also attempt it opportunistically.
11. **Judges self-verify with `DemoRegistrar.selfRegister()` (D-034).** It registers the caller as
    Indonesian **retail**, with no expiry. On Arc it was broken until the registrar was redeployed on
    2026-09-13 (§7.1).
12. **Investor classes cap purchases (D-028):** retail 5,000 mUSD per wallet, accredited 50,000,
    institutional uncapped within the raise (`PrimaryOffering.setClassLimit`). There are three
    classes. There is no "Reg S" class.
13. **Deployment is two transactions from the same wallet (D-033):** `AssetFactory.beginAssetSystem`,
    then `completeAssetSystem`, with `abandonAssetSystem` as the way out. Between them the asset is
    `Approved`, and its vault rejects deposits with `SystemNotActive()`.
14. **`termsHash` must equal `keccak256(abi.encode(DeploymentParams))`.** `approveAsset` records it,
    and `beginAssetSystem` / `completeAssetSystem` revert `TermsMismatch` if the deployed parameters
    hash differently. It is the hash of the **deployment parameters**. The legal pack references that
    hash; it cannot *be* a Merkle root of documents.
15. **The offering mints immediately on each purchase.** There is no escrow, soft cap, refund or
    threshold settlement.
16. **The market-floor liquidity range is inventory, not the protected floor.** Only
    `redemptionReserve` backs redemptions.
17. **No audit has been performed (D-027).** No screen may name an auditor, rating agency, regulator
    or legal wrapper as fact.

---

## 3. Design-wide problems (every screen)

| Pattern in the design | Status | What is true |
|---|---|---|
| Network label "Base Sepolia"; "Deploy to Base Sepolia" | **WRONG** | Live chains are Hedera 296 and Arc 5042002; Base is parked |
| "Dual-Audited (CertiK & Zellic)", "OpenZeppelin audited", "Consensys Diligence", "CertiK score 94.8" | **WRONG** | No audit exists (D-027). Remove |
| "Basel III", "Reg S / 144A", "SEC Rule 144A", "BMA", "Delaware Series LLC", "UCC-1", "ADGM", "AAA" | **WRONG** | No regulatory, legal-entity or rating claims. Out of scope (D-027) |
| "Guaranteed floor", "contractually guaranteed", "Protected Exit", "Guaranteed Backing Floor" | **WRONG** | The floor is a published reference, not a guarantee and not a bid |
| APR / "Est. Cash Yield 14.8%", "Target Base Return (Fixed Floor)" | NOT IMPLEMENTED | No yield is promised or computed on chain. Show realised distributions only, labelled historical |
| Settlement in "USDC" | **WRONG** | The asset's stablecoin is MockUSD (mUSD, 6 decimals) on every chain. Arc's native USDC gas token is unrelated |
| IoT / SCADA / Chainlink / oracle telemetry, kWh, inverter data | NOT IMPLEMENTED | No oracle contracts. NAV is verifier-published |
| Tranches, "Class A Senior", junior/senior | NOT IMPLEMENTED | One token, one class of note |
| Staking / "Auto-staking active" | NOT IMPLEMENTED | No staking contract |
| Gas sponsorship, relayer, paymaster, multisig signer panels | NOT IMPLEMENTED | Plain wallet transactions |
| No "Verify me" action anywhere | **Missing** | `DemoRegistrar.selfRegister()` is the only way a judge's wallet can buy |

---

## 4. Screen matrices

### 4.1 `launchpad_offerings` and `launchpad_offerings_desktop`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `launchpad_offerings#kyc-badge` | "KYC Verified" | LIVE | `IdentityRegistry.isVerified(wallet)` (also `AssetToken.isVerified`). Must read false for an unverified wallet |
| `launchpad_offerings#erc3643-badge` | "ERC-3643 KYC Compliant" | LIVE, relabel | ERC-3643-shaped `IdentityRegistry` + `ModularCompliance`; label "ERC-3643-shaped, demo verifier" |
| `launchpad_offerings#audit-badge` | "Dual-Audited Vaults" | **WRONG** | Remove (D-027) |
| `launchpad_offerings#protocol-tvl` | "Total Protocol TVL $14,280,000" | DERIVED | Sum of `AssetVault.totalAccounted()` across assets; demo value is tens of thousands, not millions |
| `launchpad_offerings#avg-apr` | "Avg. Cash APR 14.20%" | NOT IMPLEMENTED | — |
| `launchpad_offerings#reserve-solvency` | "Reserve Solvency 100.0% On-Schedule" | LIVE | `AssetVault.isSolvent()`, `isBehindSchedule()`, `isInEnforcedShortfall()` |
| `launchpad_offerings#historical-default` | "Historical Default 0.00%" | NOT IMPLEMENTED | Only `AssetStatus.Defaulted` exists per asset |
| `launchpad_offerings#subscribed-progress` | "84.5% Subscribed, $84,500 of $100,000" | DERIVED | `PrimaryOffering.stablecoinRaised()` / `fundraisingCap()`. **Live cap is 80,000 mUSD** |
| `launchpad_offerings#remaining` | "Remaining $15,500" | DERIVED | `fundraisingCap − stablecoinRaised` and `availableTokenInventory()` |
| `launchpad_offerings#issue-price` | "1.00 mUSD / token" | LIVE | `PrimaryOffering.tokenPrice()` |
| `launchpad_offerings#min-ticket` | "Min. Ticket: 500 mUSD" | LIVE, wrong value | `minimumPurchase()` is **1 mUSD** on the testnets |
| `launchpad_offerings#closes-in` | "Closes in 4d 18h" | LIVE | `PrimaryOffering.endsAt()`; open also requires asset Active |
| `launchpad_offerings#whitelist-open` | "Whitelist Open" | LIVE, relabel | Offering open (`startsAt ≤ now ≤ endsAt`, asset Active). No whitelist beyond the identity registry |
| `launchpad_offerings#sinking-floor` | "Sinking Floor 0.38, Ratchet Active ↑" | LIVE, relabel | `FloorController.floorPrice()`. Label as a published reference, not a floor anyone is paid |
| `launchpad_offerings#verified-nav` | "Verified NAV 1.12" | LIVE | `AssetRegistry.navOf(assetId)` (live 1.000000), with `isNAVStale` |
| `launchpad_offerings#grace-days` | "Grace: 0 Days" | LIVE | `AssetVault.shortfallStartedAt()` against the 30-day grace |
| `launchpad_offerings#rev-share` | "60% Rev-Share par" / "60% gross revenue/mo" | LIVE, relabel | `RevenueDistributor.activeSplit()`; 60% only while on schedule (40% behind) |
| `launchpad_offerings#retention-copy` | "retains 40% of energy billing into sovereign paper" | **WRONG** | The reserve share is 25% (45% behind schedule). No sovereign paper; `MockYieldSource` is a demo |
| `launchpad_offerings#redeem-copy` | "burn tokens anytime at min(NAV, backing)" | LIVE, qualify | The formula is correct. Also subject to the per-day period limit, asset status and reserve liquidity |
| `launchpad_offerings#legal-disclaimer` | "structured contractual debt claims, not corporate common equity… not a stablecoin" | LIVE (copy) | Consistent with rule 1. Keep |
| `launchpad_offerings#pipeline-cards` | LOGI04, WIND02, "Verification Stage 3/4", "Audited by JLL" | NOT IMPLEMENTED | These assets do not exist on chain. The registry does support many assets with `Pending` / `Approved` status (`statusOf`); stages, audits and data rooms do not |
| `launchpad_offerings#mechanics-ratchet` | "Revenue allocations step up the redemption floor continuously" | **WRONG** | Revenue raises `redemptionReserve` and so backing. The floor moves only via `levelUp()`. Redemption is not paid at the floor |
| `launchpad_offerings#mechanics-spv` | "Bankruptcy-Remote SPV", "first-priority mortgages" | NOT IMPLEMENTED | — |
| `launchpad_offerings#mechanics-slashing` | "Instant Telemetric Slashing" | NOT IMPLEMENTED | — |

### 4.2 `asset_detail_secondary_trading_solar01_1` and `_2`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `asset_detail_secondary_trading_solar01#spot-price` | "Spot $1.042, Secondary AMM weighted average" | LIVE, relabel | Pool `slot0` via `marketPrices()` spot. **Not** a weighted average (D-036) |
| `asset_detail_secondary_trading_solar01#nav` | "Verified NAV (Asset Floor) $1.120, JLL Quarterly" | LIVE, relabel | `navOf`. NAV is **not** a floor. No JLL; the verifier role publishes it |
| `asset_detail_secondary_trading_solar01#protected-floor` | "Protected Floor Lvl 8 $0.380, contractually guaranteed" | LIVE, **WRONG copy** | `FloorController.floorPrice()`. Remove "guaranteed"; it is a reference, not a bid |
| `asset_detail_secondary_trading_solar01#apr` | "Est. Cash Yield 14.80%" | NOT IMPLEMENTED | — |
| `asset_detail_secondary_trading_solar01#scada-status` | "SCADA 99.8% Online" | NOT IMPLEMENTED | — |
| `asset_detail_secondary_trading_solar01#volume-liquidity` | "24h Volume $42,150 / $310k" | DERIVED | Canonical pool `Swap` events and position liquidity |
| `asset_detail_secondary_trading_solar01#corridor-chart` | Spot, floor, NAV, "Parity $1.000", "Genesis Lock $0.300" | DERIVED | Candles from pool swaps; NAV from `NAVUpdated`; floor from `FloorLevelUp`. The 0.30 → 1.00 line is the **backing schedule** (`targetBackingAt`), not a floor |
| `asset_detail_secondary_trading_solar01#ratchet-rate` | "Ratchet Rate +$0.010 / 30d, Cooldown 18m" | **WRONG** | One tick spacing per `levelUp()`; cooldown `floorLevelCooldown()` (5 s on testnets) |
| `asset_detail_secondary_trading_solar01#claim-yield` | "Unclaimed $142.80, Claim Yield" | LIVE | `RevenueDistributor.claimableRevenue(wallet)` → `claimRevenue()`. $142.80 is the frontend fixture value |
| `asset_detail_secondary_trading_solar01#settlement-ledger` | Epochs, payouts, on-chain proof | DERIVED | `RevenueDeposited(periodId, amount, reportHash, …)` events |
| `asset_detail_secondary_trading_solar01#ledger-kwh-invoice` | "Gross Generation kWh", "Offtaker Invoice" | NOT IMPLEMENTED | — |
| `asset_detail_secondary_trading_solar01#reserve-vault-funded` | "104.2% Funded, Vault $38,200 / Required $36,650" | DERIVED, relabel | `redemptionReserve` against `targetBackingNow() × investorSupply` (schedule) or `minimumRequiredReserve()` (ratio). Say which. It does not "guarantee the floor" |
| `asset_detail_secondary_trading_solar01#credit-rating` | "Off-taker AAA, SCB guarantee" | NOT IMPLEMENTED | — |
| `asset_detail_secondary_trading_solar01#swap-panel` | "Swap mUSD for SOLAR01" | LIVE | `AssetMarketManager.swapExactInput`; see §5 |
| `asset_detail_secondary_trading_solar01#swap-protocol-fee` | "Protocol Fee 0.05%" | **WRONG** | Pool fee tier is **0.30%** (3000), paid to the pool's liquidity positions. No separate protocol trading fee |
| `asset_detail_secondary_trading_solar01#swap-price-impact` | "0 Price Impact" | **WRONG** | A real concentrated-liquidity pool; demo liquidity is thin and impact is large. Quote it |
| `asset_detail_secondary_trading_solar01#swap-route` | "ARC Concentrated Engine" | LIVE | Routed through the manager into the single canonical pool |
| `asset_detail_secondary_trading_solar01#instant-redeem` | "Burn against Sinking Reserve at fixed ratchet price $0.380" | **WRONG** | `RedemptionController.redeem` pays `redemptionPrice(Normal)` = `min(NAV, backing)`, **1.000000 today**. Never the floor price |
| `asset_detail_secondary_trading_solar01#daily-allowance` | "Daily Allowance $25,000 mUSD" | LIVE, wrong unit | `periodLimitTokens` = **25,000 SOLAR01** per 1-day period; `redeemedThisPeriod` |
| `asset_detail_secondary_trading_solar01#spread-delta` | "−$0.662 (−63.5% vs Spot)" | **WRONG** | Compare spot against `redemptionPrice`, not the floor |
| `asset_detail_secondary_trading_solar01#position-balance` | "Holding 2,500 SOLAR01" | LIVE | `AssetToken.balanceOf(wallet)` |
| `asset_detail_secondary_trading_solar01#position-market-value` | "Spot Market Value $2,605" | DERIVED | balance × spot |
| `asset_detail_secondary_trading_solar01#position-accrued` | "Accrued Yield $37.12" | LIVE | `claimableRevenue(wallet)` |
| `asset_detail_secondary_trading_solar01#position-pnl` | "Unrealized P&L, Cost Basis $1.000" | NOT IMPLEMENTED | No cost basis on chain; transfers break any inference from `TokensPurchased` |
| `asset_detail_secondary_trading_solar01#protected-exit` | "Protected Exit $950" | **WRONG** | Exit value is balance × `redemptionPrice`, subject to the period limit |
| `asset_detail_secondary_trading_solar01#auto-staking` | "Auto-staking active" | NOT IMPLEMENTED | — |
| `asset_detail_secondary_trading_solar01#institutional-verification` | CertiK score, Chainlink PoR, IPFS deed | NOT IMPLEMENTED | `AssetRegistry` stores `metadataURI` and `metadataHash` from `submitAsset`; that is the only anchor |

### 4.3 `asset_owner_listing_flow` and `asset_owner_listing_flow_desktop`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `asset_owner_listing_flow#upfront-65` | "65% Upfront Proceeds… routed to your treasury upon vault ignition" | LIVE, **WRONG copy** | 65% accrues per purchase to `issuerProceeds`; issuer withdraws with `withdrawIssuerProceeds` (blocked in enforced shortfall). Nothing is paid at deployment |
| `asset_owner_listing_flow#retained-equity` | "100% Retained Equity / Asset Ownership" | NOT IMPLEMENTED | No legal title on chain; do not imply equity mechanics |
| `asset_owner_listing_flow#settlement-split` | "Issuer 65% / Reserve 30% / Liquidity 5% (Uniswap V3 pair pool)" | LIVE, qualify | Constant in `PrimaryOffering`. The 5% sits in `marketMakingAllocation` until a keeper deploys it |
| `asset_owner_listing_flow#revenue-covenant` | 60/25/10/5 | LIVE | `onScheduleSplit`; show the 40/45/10/5 alternative too |
| `asset_owner_listing_flow#ipfs-documents` | Pinned PDFs, "Merkle Hash Verified" | NOT IMPLEMENTED | Only `submitAsset(metadataURI, metadataHash)` anchors a single reference |
| `asset_owner_listing_flow#backing-trajectory` | 0.30 → 1.00 over 3 years | LIVE | `setReserveSchedule(300000, 1000000, start, maturity, 30 days)` |
| `asset_owner_listing_flow#safeguard-covenant` | "withdrawal governed by solvency checks… 30-day grace" | LIVE | `withdrawIssuerProceeds` reverts `ReserveShortfallActive` after the 30-day grace |
| `asset_owner_listing_flow#submit-for-review` | "Submit for Verifier Review" | LIVE | `AssetRegistry.submitAsset(...)` → `AssetSubmitted`; asset enters `Pending` |
| `asset_owner_listing_flow#review-sla` | "Estimated Review 48h", "Zero upfront listing fees" | NOT IMPLEMENTED | — |

### 4.4 `asset_owner_listing_flow_step_1_asset_classification`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…step_1#asset-class` | Six asset classes with risk tiers and LTV | LIVE / NOT IMPLEMENTED | `submitAsset` takes a free-text `category`. Risk tiers and LTV are not modelled |
| `…step_1#registry-identifier` | Series name / symbol | LIVE | `submitAsset` `name`; token name and symbol are fixed at deploy in `DeploymentParams` |
| `…step_1#jurisdiction` | Operating jurisdiction | NOT IMPLEMENTED | Compliance allows country 360 only (`CountryAllowModule`) |
| `…step_1#inception-term` | Remaining PPA term | LIVE, partial | Only `maturityTimestamp` (`submitAsset`, `maturityOf`) |
| `…step_1#telemetry-framework` | Schneider, Chainlink, Siemens, SCADA | NOT IMPLEMENTED | — |
| `…step_1#offtaker-credit` | Off-taker, guarantor, rating, "Verify Hash" | NOT IMPLEMENTED | — |
| `…step_1#production-history` | 12-month kWh chart | NOT IMPLEMENTED | — |
| `…step_1#underwriting-eligibility` | "4/4 Validated", "Algorithmic Appraisal", DSCR | NOT IMPLEMENTED | — |
| `…step_1#zk-commitment` | "sealed on-chain via ZK-commitments" | **WRONG** | No ZK. `metadataHash` is a plain `bytes32` commitment |

### 4.5 `asset_owner_listing_flow_step_2_capital_structuring`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…step_2#target-sizing` | "$100,000 target, $50,000 soft-cap, $1,000,000 hard-cap" | LIVE / NOT IMPLEMENTED | `fundraisingCap` is a hard cap (80,000 mUSD live). **No soft cap**; the offering mints on every purchase |
| `…step_2#par-price` | "$1.00 mUSD, Genesis Par Peg" | LIVE, **WRONG copy** | `tokenPrice` is the offering price. There is no peg |
| `…step_2#total-supply` | "100,000 SOLAR01, non-dilutive fixed mint" | **WRONG** | `maximumSupply` caps at 100,000; tokens mint per purchase; offering inventory 80,000; 20,000 unminted headroom (D-031) |
| `…step_2#ticket-limits` | "$500 / $15,000 per verified address" | LIVE, wrong values | `minimumPurchase` (1 mUSD) and `walletPurchaseLimit` (50,000 mUSD), then class limits |
| `…step_2#split-invariant` | "65/30/5, ERC-4626 derivative split" | LIVE / **WRONG** | 65/30/5 is real. The vault is **not** ERC-4626; it is a five-category accounting vault |
| `…step_2#reserve-genesis` | "30% sealed, baseline floor backing $0.30/token" | LIVE, relabel | 30% goes to `redemptionReserve`. 0.30 is the backing-schedule start, not a floor |
| `…step_2#amm-range` | "tick ranges 0.985–1.015 mUSD", "Peg Stability ±1.5%" | **WRONG** | Deploy-time anchor spans ≈0.973–1.033 mUSD (ticks −276600…−276000 around −276325), discovery ≈1.033–1.165, market-floor range ≈0.813–0.973. A keeper can move them. No peg |
| `…step_2#eligibility-classes` | "QIB & Accredited uncapped / Retail $2,500 / US Reg S" | LIVE, wrong values | Three classes: retail 5,000, accredited 50,000, institutional uncapped (`setClassLimit`). No Reg S |
| `…step_2#listing-fee` | "$0.00, 5% on distributions" | LIVE, relabel | The protocol share is 5% of each revenue deposit to `protocolFees`; no listing fee exists either way |
| `…step_2#liquidity-shield` | "sellers find liquidity without touching the 30% reserve" | LIVE | Market capital and `redemptionReserve` are separate buckets (`CLAUDE.md` rule 3) |

### 4.6 `asset_owner_listing_flow_step_3_revenue_sinking_schedule`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…step_3#split-toggle` | "Healthy 60/25/10/5 / Solvency Tilt 40/45/10/5" | LIVE | `onScheduleSplit`, `behindScheduleSplit`, `activeSplit()` |
| `…step_3#tilt-trigger` | "lags >30 consecutive days → 40/45" | **WRONG** | The split tilts immediately when `isBehindSchedule()` is true at deposit. 30 days is the shortfall grace, which only blocks issuer withdrawals |
| `…step_3#fixed-floor-return` | "14.80% APR (Fixed Floor)" | **WRONG** | No return is fixed or promised |
| `…step_3#amortization-points` | Month 0 $0.300, 12 $0.533, 24 $0.766, 36 $1.000 | LIVE | Linear `targetBackingAt`. (Step 5 prints Month 24 as $0.78; the correct value is 0.766) |
| `…step_3#solvency-ratchet` | "+$0.010 / 30 days, enforced upward floor" | **WRONG** | One tick spacing per `levelUp()` |
| `…step_3#grace-period` | "30 Calendar Days" | LIVE | `reserveSchedule.graceSeconds` |
| `…step_3#refill-cooldown` | "18-Month Lock, no early principal redemption" | **WRONG** | No lock. Redemption is open while Active, within the period limit |
| `…step_3#oracle-pipeline` | Settlement cycle, IoT hook, oracle bridge | NOT IMPLEMENTED | Revenue enters only by `depositRevenue` from `REVENUE_DEPOSITOR_ROLE` |
| `…step_3#reporting-cadence` | "Every 30 Days" | LIVE | `setReportingPolicy(30 days, 30 days)`, `reportingDueAt()`, `isReportingOverdue()`. A covenant **flag** that gates nothing |
| `…step_3#returns-simulator` | Monthly split preview | DERIVED (client) | Arithmetic over `activeSplit()`. Label illustrative |
| `…step_3#surplus-unlock` | "Surplus unlocks after Month 18" | NOT IMPLEMENTED | — |
| `…step_3#default-ladder` | Grace, "Automatic Shortfall Lock", "90-Day Verifier Default locks issuer keys", "Trustee Lien Enforcement" | LIVE / NOT IMPLEMENTED | Real: enforced shortfall blocks `withdrawIssuerProceeds`; the verifier can `suspendAsset` / `markDefault`; emergency redemption opens when Suspended or Defaulted. Not real: freezing the operator's 10%, key locks, automatic 90-day default, trustee or lien action |

### 4.7 `asset_owner_listing_flow_step_4_legal_spv_binding`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…step_4#spv-entity` | Delaware Series LLC, file ID, trustee | NOT IMPLEMENTED | No legal wrapper (D-027) |
| `…step_4#lien-registry` | "Book 490 / Page 1120", first-priority mortgage | NOT IMPLEMENTED | — |
| `…step_4#ipfs-deeds` | Four CIDs, sizes, integrity status | NOT IMPLEMENTED | — |
| `…step_4#term-sheet-hash` | "Compiled Term Sheet Merkle Hash of four legal artifacts, inscribed at Stage 5" | **WRONG** | `termsHash` must equal `keccak256(abi.encode(DeploymentParams))`, or deployment reverts `TermsMismatch`. A Merkle root of documents would make the asset undeployable. The legal pack should **reference** the params hash |
| `…step_4#bound-registry` | "bound to AssetRegistry 0x489F…" | LIVE, relabel | `approveAsset(assetId, initialNAV, termsHash)` records it; `termsHashOf(assetId)` reads it; event `TermsApproved` |
| `…step_4#enforcement-layers` | "Accounting onchain / Remedy in Delaware Chancery" | NOT IMPLEMENTED | Keep only the accounting half, and call it ERC-3643-shaped |
| `…step_4#signatories` | EIP-1271 signatures, counsel, notary | NOT IMPLEMENTED | — |

### 4.8 `asset_owner_listing_flow_step_5_verifier_review_vault_ignition`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…step_5#gas-sponsored` | "100% Protocol Sponsored Gas" | NOT IMPLEMENTED | — |
| `…step_5#check-compliance` | "ERC-3643 engine, ONCHAINID, transfer restrict controller" | LIVE, relabel | `IdentityRegistry`, `ModularCompliance`, `AssetToken.transferRestriction(from, to, value)`. No ONCHAINID |
| `…step_5#check-vault-isolation` | "Five-category vault, ERC-4626, audit CZ-2025-091, invariant proven" | LIVE / **WRONG** | Five categories are real (`AssetVault`). Not ERC-4626; no audit; invariants are tested, not proven |
| `…step_5#check-nav` | "JLL initial NAV $1.120" | LIVE, relabel | `approveAsset(assetId, initialNAV, termsHash)` sets NAV; event `NAVUpdated`. No JLL |
| `…step_5#check-ratchet` | "0.300 → 1.000 schedule inscribed; auto collateral auction" | LIVE / NOT IMPLEMENTED | Schedule is real. No auction |
| `…step_5#ratchet-rate` | "2.78% / Month" | **WRONG** | Backing target rises ≈0.0194 mUSD/month linearly; the floor moves by tick spacing |
| `…step_5#term-summary` | Raise $100,000 / 100,000 tokens / 65-30-5 / 60-25-10-5 / 36 months | LIVE, wrong values | Live: cap 80,000 mUSD, supply cap 100,000 (80,000 inventory), 3-year maturity, splits as stated |
| `…step_5#merkle-root` | Merkle root hash | **WRONG** | See `…step_4#term-sheet-hash` |
| `…step_5#ignition-button` | "Deploy Vault Contracts to Base Sepolia via CREATE2" | LIVE, **WRONG copy** | Two transactions from the issuer wallet (D-033): `beginAssetSystem` → `AssetSystemBegun`, then `completeAssetSystem` → `AssetSystemDeployed`. Components use CREATE; only the pool is CREATE2 (by Uniswap). Chain is Hedera or Arc |
| `…step_5#maker-checker` | "2-of-2 co-signatures before liquidity activates" | NOT IMPLEMENTED | A single `VERIFIER_ROLE` calls `approveAsset` |
| `…step_5#factory-address` | "AssetFactory 0x94f1…" | LIVE, placeholder | Read `factory` from `deployments/<chainId>.json` |
| `…step_5#levelup-relayer` | "LevelUp Configured, Gelato Relayer" | LIVE / NOT IMPLEMENTED | `FloorController` is configured at deploy and `levelUp()` is permissionless. No relayer |
| `…step_5#submit-final-cosign` | "Submit for Verifier Final Co-Sign" | LIVE, relabel | The verifier calls `approveAsset`; the issuer cannot self-approve |

### 4.9 `asset_owner_operational_reports_document_filing`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…document_filing#filing-gateway` | Upload, OCR, SHA-256, encrypt, "Upload & Inscribe to IPFS Merkle Tree" | NOT IMPLEMENTED | — |
| `…document_filing#revenue-report-anchor` | Monthly meter & invoicing log category | LIVE, partial | The only on-chain report anchor is `reportHash` in `depositRevenue(amount, periodId, reportHash)`, emitted in `RevenueDeposited`. Other categories have none |
| `…document_filing#filing-ledger` | Documents, CIDs, "Verified & Pinned" | NOT IMPLEMENTED | — |
| `…document_filing#verifier-queue` | CertiK + JLL consensus 2/2, comments | NOT IMPLEMENTED | — |
| `…document_filing#master-root` | "Master Covenant Root (ArcReserveVault.sol)" | **WRONG** | No such contract or root. Anchors are `termsHash`, `metadataHash` and per-deposit `reportHash` |
| `…document_filing#deadlines` | Month-end seal, inspection, franchise renewal | LIVE, partial | Only the revenue reporting cadence exists: `reportingDueAt()`, `isReportingOverdue()` |
| `…document_filing#proof-of-reserve` | "Download Proof of Reserve Certificate" | NOT IMPLEMENTED | Reserve is readable directly: `redemptionReserve`, `totalAccounted`, `isSolvent` |

### 4.10 `asset_owner_infrastructure_telemetry_monitoring`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…telemetry_monitoring#energy-telemetry` | kWh, inverters, grid export, temperatures, oracle signature | NOT IMPLEMENTED | — |
| `…telemetry_monitoring#managed-asset-value` | "$2,400,000 mUSD" | DERIVED | NAV × supply (live: ≈5,000 mUSD) |
| `…telemetry_monitoring#revenue-accrued` | "Revenue Accrued (M05)" | DERIVED | Sum of `RevenueDeposited` for the period |
| `…telemetry_monitoring#sinking-solvency` | "104.2% Backed, $38,200 locked / $36,650 target" | DERIVED | `redemptionReserve` against `targetBackingNow() × investorSupply` |
| `…telemetry_monitoring#execute-distribution` | "Execute Yield Distribution" | LIVE | `depositRevenue(amount, periodId, reportHash)`; see §5 |
| `…telemetry_monitoring#covenant-ratchet` | "+0.010 mUSD / 30d" | **WRONG** | See rule 10 |
| `…telemetry_monitoring#delinquency-tracker` | "0 Days Delinquent" | LIVE, relabel | `isReportingOverdue()` and `shortfallStartedAt()`; flags, not enforcement (except issuer withdrawals) |
| `…telemetry_monitoring#settlement-desk` | 60/25/10/5 amounts, "Prepare Settlement Batch" | DERIVED / LIVE | Preview from `activeSplit()`; executing is `depositRevenue` |
| `…telemetry_monitoring#fleet-registry` | Two facilities, LOGI04 underwriting | NOT IMPLEMENTED | Only SOLAR01 exists on the live chains |
| `…telemetry_monitoring#health-hub` | Gateways, failover, satellite uplink | NOT IMPLEMENTED | — |

### 4.11 `asset_owner_yield_share_waterfall_distribution`

| Key | Screen shows | Status | Truth |
|---|---|---|---|
| `…waterfall_distribution#split-allocation` | 60/25/10/5 of gross | LIVE | `depositRevenue` splits by `activeSplit()` → `RevenueDeposited` |
| `…waterfall_distribution#investor-apr` | "14.80% APR to 100k SOLAR01" | NOT IMPLEMENTED | Distribution is per **yield-eligible** token (`yieldEligibleSupply`), live 5,000 |
| `…waterfall_distribution#sinking-floor-move` | "Floor $0.380 → $0.390, Guaranteed Collateral Ratchet" | **WRONG** | The 25% raises the reserve. The floor moves only by `levelUp()` and is not guaranteed |
| `…waterfall_distribution#tilt-condition` | "safety tilt below 95% solvency" | **WRONG** | Trigger is `isBehindSchedule()`: backing below the schedule target |
| `…waterfall_distribution#reconciliation` | Bank telemetry, Swift MT799 oracle, L/C | NOT IMPLEMENTED | — |
| `…waterfall_distribution#batch-call` | "DualVaultController.sol atomic three-contract split" | **WRONG** | No such contract. One call: `RevenueDistributor.depositRevenue`. Holders' share accrues in the distributor for `claimRevenue`; the reserve share moves to the vault; operator and protocol shares accrue for their claims |
| `…waterfall_distribution#merkle-receipt` | Rollup anchor, SEC 144A | NOT IMPLEMENTED | — |
| `…waterfall_distribution#historical-ledger` | Epochs with investor / sinking / operator columns | DERIVED | `RevenueDeposited` events |
| `…waterfall_distribution#multisig-console` | "3 of 5 Keys", paymaster | NOT IMPLEMENTED | One `REVENUE_DEPOSITOR_ROLE` holder |
| `…waterfall_distribution#operator-claim` | "Claim OpEx Allowance $1,482" | LIVE | `RevenueDistributor.claimOperatorRevenue()`, operator only → `OperatorRevenueClaimed`. Pays the operator address; routes and bank off-ramp are not implemented |
| `…waterfall_distribution#treasury-bills` | "locks 25% in US Treasury bills" | **WRONG** | The reserve holds mUSD. `MockYieldSource` is a labelled demo |
| `…waterfall_distribution#protocol-fee` | "Protocol Fee (5%)" | LIVE | Accrues to the vault's `protocolFees` category |

### 4.12 `arcreserve_logo` and `arcreserve_brand_emblem`

No protocol behaviour. Brand assets only.

---

## 5. Wallet writes

Authoritative signatures from `contracts/src`. The approval target is where the tokens are pulled from
(`safeTransferFrom(msg.sender, …)`) or checked.

| Action (screen) | Call | Caller | Approve first | Confirm on receipt |
|---|---|---|---|---|
| Verify wallet (missing from design) | `DemoRegistrar.selfRegister()` | any wallet | — | `SelfRegistered(wallet, 360, 1)`. A second call is a silent no-op; check `IdentityRegistry.isVerified` |
| Test mUSD | `MockUSD.faucet()` or `faucet(address,uint256)` | any wallet | — | `FaucetUsed` |
| Primary buy (`launchpad_offerings`) | `PrimaryOffering.buy(uint256 stablecoinAmount, uint256 minimumTokensOut)` | verified wallet | mUSD → **offering** | `TokensPurchased` |
| Swap / trade (`asset_detail…#swap-panel`) | `AssetMarketManager.swapExactInput(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline)` | any wallet (must be verified to receive SOLAR01) | `tokenIn` → **market manager** | `SwapExactInput(trader, tokenIn, amountRequested, amountSpent, amountOut)`; flywheel side effects `MarketSurplusCredited`, `FloorLevelUp`, `FlywheelSkipped`, `FloorLevelUpSkipped` |
| Redeem (`asset_detail…#instant-redeem`) | `RedemptionController.redeem(uint256 tokenAmount, uint256 minimumStablecoinOut, uint8 mode)` (mode 0 = Normal) | holder | **none** (burned via `burnForRedemption`) | `Redeemed(holder, mode, tokens, stablecoin, nav, price)` |
| Claim yield | `RevenueDistributor.claimRevenue()` | holder | — | `RevenueClaimed` |
| Raise the floor | `FloorController.levelUp()` | any wallet | — | `FloorLevelUp` |
| Submit asset (listing flow) | `AssetRegistry.submitAsset(string name, string category, string metadataURI, bytes32 metadataHash, uint64 maturityTimestamp)` | issuer wallet (recorded as `issuerOf`) | — | `AssetSubmitted` |
| Approve asset (step 5) | `AssetRegistry.approveAsset(bytes32 assetId, uint256 initialNAV, bytes32 termsHash)` | `VERIFIER_ROLE` | — | `TermsApproved`, `NAVUpdated`, `AssetStatusChanged(→Approved)` |
| Deploy, phase 1 | `AssetFactory.beginAssetSystem(DeploymentParams params)` | the asset's issuer | — | `AssetSystemBegun` |
| Deploy, phase 2 | `AssetFactory.completeAssetSystem(bytes32 assetId, DeploymentParams params)` | **same wallet** as phase 1 | — | `AssetSystemDeployed` (fires once) |
| Abandon a half-built deploy | `AssetFactory.abandonAssetSystem(bytes32 assetId)` | phase-1 initiator | — | `AssetSystemAbandoned` |
| Seed reserve | `AssetVault.depositInitialReserve(uint256)` | issuer | mUSD → **vault** | `InitialReserveDeposited` |
| Top up reserve | `AssetVault.depositReserve(uint256 amount, uint256 periodId)` | issuer | mUSD → **vault** | `ReserveContribution` |
| Withdraw proceeds | `AssetVault.withdrawIssuerProceeds(uint256)` | issuer | — | `IssuerProceedsWithdrawn` |
| Distribute revenue (waterfall) | `RevenueDistributor.depositRevenue(uint256 amount, uint256 periodId, bytes32 reportHash)` | `REVENUE_DEPOSITOR_ROLE` | mUSD → **revenue distributor** | `RevenueDeposited` |
| Operator allowance | `RevenueDistributor.claimOperatorRevenue()` | operator address | — | `OperatorRevenueClaimed` |
| Publish NAV | `AssetRegistry.publishNAV(bytes32, uint256)` | `VERIFIER_ROLE` | — | `NAVUpdated` |
| Status actions | `suspendAsset` / `resumeAsset` / `markDefault` / `markMatured` `(bytes32)` | `VERIFIER_ROLE` | — | `AssetStatusChanged` |

Transfers are permissioned: `AssetToken.transferRestriction(address from, address to, uint256 value)`
previews the first failing rule for any transfer or receipt.

---

## 6. Refusals worth demonstrating to judges

Each is deterministic and names a real rule. Show the decoded error name, not "transaction failed".

| Demonstration | How | Error |
|---|---|---|
| Unverified wallets cannot hold the note | Buy or swap into SOLAR01 from a fresh wallet | `RecipientNotVerified()` |
| Then self-verify and succeed | `selfRegister()`, repeat the buy | succeeds (Hedera; Arc after §7.1) |
| Class cap | A self-registered (retail) wallet buys more than 5,000 mUSD | `ClassWalletLimitExceeded()` |
| Offering hard cap / inventory | Buy past `fundraisingCap` or inventory | `FundraisingCapExceeded()` / `InventoryExceeded()` |
| Transfer to an unverified wallet | Send SOLAR01 to a fresh address | `RecipientNotVerified()` (preview via `transferRestriction`) |
| NAV cannot jump | Publish NAV more than 20% from the last | `NAVMovementTooLarge()` |
| Deployment must match approved terms | `beginAssetSystem` with any parameter changed | `TermsMismatch()` |
| Floor ratchet is rate-limited and capped | `levelUp()` twice inside the cooldown; or past `min(NAV, backing)` | `CooldownActive()` / `FloorCeilingExceeded()` |
| Anchor moves only when price left its band | Keeper `slide` while spot is inside the anchor | `InvalidRange()` |
| Redemption is period-limited | Redeem more than 25,000 SOLAR01 in one day | `PeriodLimitExceeded()` (needs a holder above 25,000; live supply is 5,000) |
| Slippage protection | Swap with a `minAmountOut` above the quote | `SlippageExceeded()` |
| Nothing to claim | `claimRevenue()` with no accrual | `NoRevenueToClaim()` |

Not currently demonstrable on the live chains: `ReserveShortfallActive()` (backing is far above
schedule) and anything maturity-related (maturity is three years out).

---

## 7. Known defects and gaps that affect these screens

1. **FIXED 2026-09-13 — judges could not self-verify on Arc.** The first Arc `DemoRegistrar`
   (`0x86738829…`) reverted `UnsupportedChain(5042002)` on every call, because its demo-chain list
   omitted Arc. The contract and its test now include 5042002, and `DeployDemoRegistrar` now replaces a
   registrar that is attached but not working instead of reporting it as done. With the owner's
   approval the Arc registrar was redeployed at **`0xF6f77D0bE395df3d04B6E58a4a8fb0c34EC5286d`**.
   Verified on chain: `isActive` true, `canSelfRegister(fresh)` true, `selfRegister` succeeds from a
   fresh address, the new registrar holds `REGISTRY_AGENT_ROLE` and the old one no longer does.
   Hedera's registrar is unchanged. Read the address from `deployments/5042002.json`. Keep gating
   "Verify me" on `canSelfRegister(wallet) && isActive()`; that pair would have hidden the button on the
   broken registrar.
2. **The frontend's revenue deposit is broken.** `frontend/src/lib/contracts.ts` declares
   `depositRevenue(uint256)` and `operator-forms.tsx` passes one argument; the contract takes three.
3. **Writes the frontend has no code for:** `swapExactInput` (its action deck still says a router is
   "intentionally not included"), `approveAsset`, `selfRegister`, `beginAssetSystem` /
   `completeAssetSystem`, `depositReserve`, `claimOperatorRevenue`, `levelUp`.
4. **The price chart ignores the chain.** `useCandles` (`frontend/src/lib/queries.ts:86`) sends no
   `chainId`, so it shows whichever chain the API process serves.
5. **`swapExactInput` needs an explicit gas limit, and a wallet estimate can be too low. Measured,
   not hypothesised.** Hedera's `eth_estimateGas` returned 563,841, and the mined swap
   (`0xbf808ac3`) reverted out of gas. A `cast run` trace shows the trade, the discovery harvest and
   `creditMarketSurplus` all completed. It ran out of gas inside `FloorController.canLevelUp()`, and
   the out-of-gas escaped the `try/catch` around the floor step. Re-executed on a fork of the state
   just before that transaction, forwarding exact gas to the manager:
   - **≤ 510,000** execution gas: the whole swap reverts.
   - **520,000–560,000**: reverts after the surplus credit. The mined failure falls here, since the
     563,841 limit minus ~22k intrinsic gas leaves about 542k.
   - **≥ 570,000**: succeeds with the full flywheel (`SwapExactInput`, `MarketSurplusCredited`,
     `FloorLevelUp`).
   - **No band succeeded while skipping a step.** A guarded step that runs out of gas takes the whole
     transaction with it, because the 1/64 of gas the caller keeps back (EIP-150) cannot pay for the
     catch branch. So D-035's "the engine can never fail a trade" holds for logical reverts and
     **not for out-of-gas**. Partial accounting is never committed either way.
   - The successful swap *reported* 469,867 gas, well below the ~592k limit it needed: reported usage
     is after refunds and excludes gas held back across nested calls. **Never size the limit from a
     past receipt.**

   Rule: send `swapExactInput` with an explicit limit of **1,000,000 gas on both chains**. That is
   ~70% headroom over the measured path; different state, such as a larger harvest, can cost more.
   Arc's estimate was not measured, so do not rely on it either. Whether Hedera bills the limit or
   the usage was not checked.
   `FlywheelSkipped` and `FloorLevelUpSkipped` still occur for real, non-gas reasons. The most
   common is `NO_DISCOVERY_LIQUIDITY` after discovery has been harvested. Read them from the receipt
   and show the reason.
6. **NAV staleness now prices redemptions.** With backing at 4.36× NAV, `redemptionPrice` is
   NAV-bound, and nothing on chain reads `isNAVStale` (D-039). The UI should show NAV age next to any
   redeem quote.
7. **RE-ARMED 2026-09-13 — both pools now trade both ways, within a small band.** Earlier the same
   day both pools were empty and every swap reverted `InvalidSwapDirection()`. The cause was
   structural: Phase B-1 harvests the **whole** discovery position after every swap and never
   re-mints it (Phase B-2), and `SeedMarket` funded discovery only, so no sell was ever possible.
   The owner chose a two-way market. `contracts/script/ArmMarket.s.sol` was broadcast twice on each
   chain (the rebalance cooldown forces one step per run): `slide` plus funding of the anchor to
   straddle spot, then `refreshDiscovery` plus funding of discovery above it. Resulting positions are
   in §1.

   **Verified on a fork at the head of each chain**, with `swapExactInput{gas: 1_000_000}` from a
   verified wallet. Results were identical on Hedera and Arc:

   | Sequence | Result |
   |---|---|
   | buy 10 mUSD → buy 10 mUSD → sell 5 SOLAR01 | all succeed (9.099 / 9.082 SOLAR01 out, then 5.474655 mUSD out) |
   | buy 200 mUSD → buy 10 mUSD → sell 5 SOLAR01 | the 200 buy succeeds (178.756 SOLAR01 out); **the next buy reverts `InvalidSwapDirection()`**; the sell succeeds |

   Events on the first buy of each sequence: `FlywheelSkipped(NO_SURPLUS)` and `FloorLevelUp`. Later
   swaps: `FlywheelSkipped(NO_DISCOVERY_LIQUIDITY)`, `FlywheelSkipped(NO_SURPLUS)` and
   `FloorLevelUpSkipped(NOT_ELIGIBLE)`. No `MarketSurplusCredited` fired.

   What this means for any screen:
   - **One flywheel turn per re-arm.** The first swap of either direction harvests discovery.
     Re-running `ArmMarket` re-funds discovery in place (it sees an empty discovery and a funded
     anchor), so it works as the "re-arm" keeper action.
   - **Reserve credit: none from a small trade; one buy of ≥ ~314 mUSD does credit.** Measured
     on a fork of each chain head (identical on both), each size run as the first buy from the live
     armed state:

     | Single buy | Manager mUSD after harvest | `MarketSurplusCredited` | Backing | Gas used | Next buy / sell |
     |---|---|---|---|---|---|
     | 10 | ≈73.59 | none (`NO_SURPLUS`) | unchanged | — | works / works |
     | 250 | 186.348445 | none | unchanged | 440,312 | **reverts** / works |
     | 300 | 236.348445 | none | unchanged | 439,410 | reverts / works |
     | 320 | 250 (capped) | 6.348445 | 4.359999 → 4.361269 | 515,178 | reverts / works |
     | 350 | 250 | 36.348445 | → 4.367269 | 515,192 | reverts / works |
     | 400 | 250 | 86.348445 | → 4.377269 | 515,198 | reverts / works |
     | 600 | 250 | 286.348445 | → 4.417269 | 515,212 | reverts / works |

     Arithmetic. A buy's mUSD goes into the pool, not to the manager. The manager gets mUSD back
     only from the discovery harvest. The first ≈137.24 mUSD of a buy fills the anchor and stays in
     the pool. Every mUSD beyond that trades through discovery and returns 1:1 at harvest. The gap
     to close is `principalOutstanding − balance = 250 − 73.588418 = 176.411582`, exactly the mUSD
     the anchor consumed when armed. So the **threshold is ≈ 137.24 + 176.41 = 313.65 mUSD**, and
     `credit = size − 313.65` (up to discovery's ≈655 mUSD capacity). After a credit the manager's
     balance equals principal. Every size that credits also exhausts the anchor, so buys stop until
     the keeper recovers. **No single trade gives both a credit and continued buying.** Re-arming the
     anchor draws its mUSD again and resets the same under-water gap, so this holds for every cycle.

     Options for showing the reserve credit, with the recommendation:
     - **(b) Recommended: stage it as the finale.** Run the two-way demo with small trades first
       (≤ ~10 mUSD buy, ≤ ~5 SOLAR01 sell). End with one deliberate buy of **400 mUSD** (retail cap
       5,000, so any verified class can do it). The receipt shows `MarketSurplusCredited` ≈86.35
       and backing rising ≈0.0173, which is live and legible. Buys are blocked afterwards, so the
       keeper recovers off-camera before the next demo. The recovery is manual and **unverified**:
       remove the anchor's liquidity, then `ArmMarket`, possibly several `slide` steps because
       `maxTickShift` is 1,200. Rehearse it on a fork before relying on it.
     - (c) Keep small trades only, and narrate the credit from on-chain history: both chains already
       recorded `MarketSurplusCredited` from the earlier seeded swaps. This is honest but not
       live, so label it as history.
     - (a) Re-arm so one small trade crosses principal: rejected. The under-water gap *is* the
       anchor's mUSD, which is what makes sells possible. Shrinking it shrinks sell depth
       one-for-one. Adding mUSD via `fundFromVault` raises principal by the same amount.

     Any judge journey must not promise a credit on an ordinary small trade.
   - **Buy depth is small.** The anchor holds ≈123 SOLAR01 above spot, which is about 135 mUSD of
     buying up to ≈1.1234. A buy that pushes spot past the anchor's upper tick leaves no asset-side
     liquidity once discovery is harvested, so **every later buy reverts** while sells still work.
   - **`ArmMarket` cannot recover from that state.** Discovery must sit above spot. Re-centring a
     funded anchor needs its liquidity removed first (`slide` requires an empty anchor), and the
     script does not do that. Recovery is a manual keeper `removeLiquidity(Anchor)` followed by
     `ArmMarket`. Sell depth is ≈176 mUSD down to ≈1.0580.

   UI rules: quote before sending, and cap the buy input near the quoted depth. If `pool.liquidity()`
   is 0 or the quote is 0, disable that direction with "no market liquidity right now". Never let a
   wallet reach `InvalidSwapDirection`.

---

## 8. How this was verified

- Contract facts from `contracts/src` on the shared `main` working tree (uncommitted D-038/D-039
  changes included), 2026-09-13.
- Live values read with `cast` against Hedera 296 (Hashio) and Arc 5042002 (dRPC), 2026-09-13.
- The Arc self-registration failure reproduced with `eth_call` from a fresh address; revert data
  `0xc3a55c98…004cef52` decodes to `UnsupportedChain(5042002)`.
- Frontend facts from `frontend/src/lib/contracts.ts`, `queries.ts`, `operator-forms.tsx` and
  `action-deck.tsx` in the local tree, which is behind `origin/main`. The pulled frontend may differ.
- Screen text extracted from each Stitch `code.html`. Numbers quoted from the design are the
  design's, not the chain's.
