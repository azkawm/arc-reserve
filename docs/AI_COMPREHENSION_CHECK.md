# AI Comprehension Check

Use this document before assigning material implementation work to a new AI agent. Ask the agent to
answer Part A without reading Part B during the response. The goal is to detect confident but incorrect
assumptions about financial boundaries, current implementation status, and demo data.

Recommended instruction:

> Read `CLAUDE.md` and every directly linked specification. Before changing code, answer questions
> 1-40 in your own words, identify three highest-risk misunderstandings, and state which requested
> behavior is implemented versus target-only. Do not begin implementation until the answers are
> reviewed.

## Part A: Questions for the receiving AI

### Product and truth boundaries

1. What does a SOLAR01 token represent, and which legal/economic claims must the product avoid making?
2. When contract code, system docs, and frontend fixtures disagree, what is the source-of-truth order?
3. Name the five price/value concepts that must remain distinct.
4. Is the protected floor reference a guaranteed market bid or a guaranteed 1:1 redemption price?
5. What is implemented today when an investor buys from `PrimaryOffering`, and how does that differ
   from the target fundraising flow?

### Supply, vesting, and revenue

6. Is SOLAR01 supply unlimited? What enforces the answer?
7. May `AssetMarketManager` mint new SOLAR01 when sellers disappear?
8. What is issuance headroom, and does it count as issued or circulating supply?
9. What company-vesting functionality exists today, and what part is still missing from generic
   deployment/settlement?
10. State the yield-eligible circulating-supply formula.
11. Do yield-excluded vesting tokens still count toward reserve and redemption obligations?
12. When vested tokens become eligible, can they claim revenue deposited while they were excluded?
13. How does the transfer hook prevent a new buyer from claiming a previous holder's revenue?
14. What are the current revenue-deposit percentages and where does each share reside?

### Vault and redemption

15. List all five `AssetVault` accounting categories.
16. Which vault category may the market manager withdraw, and can it ever withdraw protected reserve?
17. State both conditions in `vault.isSolvent()`.
18. How is the normal redemption price calculated?
19. Which asset status is required for Normal, Maturity, and Emergency redemption modes?
20. Why does the controller burn tokens before the vault transfers mUSD?

### Market making and Hikari

21. What are the four market position kinds and the role of each?
22. What exactly was adopted from Hikari, and what was explicitly rejected?
23. Describe the complete range-change lifecycle in the current MVP.
24. In what direction must spot be relative to TWAP for `slide` and `sweep`?
25. List the common market safety gates and their important default thresholds.
26. Which market actions remain possible while the manager is paused, and why?

### Frontend, backend, and operational status

27. Which frontend features execute real contract calls, and which major displayed values remain
   fixtures?
28. Does the current candle chart use TradingView Lightweight Charts or indexed pool trades?
29. Why can the current mock pool not produce honest live OHLC candles?
30. What should be the first implementation steps for the planned backend/indexer, and what must it
   do to handle chain reorgs safely?

### Compliance, reserve schedule, and floor (added 2026-08-27; D-021 to D-029)

31. Which two legs of a transfer does `AssetToken` check against the identity registry, and which
    accounts may be compliance-exempt? Can the canonical pool pay tokens to an unverified wallet?
32. A holder's KYC claim expired yesterday. Which of these still work: transfer to a verified
    friend, selling into the pool, redeeming against the reserve, receiving a forced transfer?
33. What does `transferRestriction(from, to, value)` return, and why would a frontend call it?
34. What is the settlement split in the target model, what is backing at settlement, and where
    does the issuer's fresh capital come from?
35. State the reserve-schedule formula and the six sources that can raise backing. What happens
    when backing is below the schedule for longer than the grace period?
36. Is the revenue deposit a share of profit or of gross revenue? Why does that matter?
37. Which tokens are excluded from the backing denominator and cannot redeem? Why?
38. By how much does the published floor move per level-up, who can trigger it, and what two
    conditions must hold? Does a level-up change what `redeem()` pays?
39. What is bound to the verifier-approved term-sheet hash, and what does the factory do if the
    hash does not match?
40. Which chains is ArcReserve meant to run on, what stablecoin does it use there, and what does
    "hackathon scope" permit and forbid?

## Scenario checks

Ask these when the task touches economics or integration:

1. Market price rises to 1.80 mUSD, NAV is 1.00, and liquid backing is 0.82. What values should the UI
   show, and what is the maximum normal redemption reference?
2. All treasury market inventory is sold and no holder wants to sell. What is the permitted liquidity
   sequence, and which component must not mint?
3. The company vesting wallet releases tokens immediately before a revenue deposit. Are the released
   tokens eligible for that new deposit? Are they eligible for earlier deposits?
4. The NAV timestamp is three days old but spot and TWAP agree. May the keeper add liquidity or
   rebalance?
5. The market manager is paused with active positions. Can the keeper add liquidity? Can it remove
   liquidity and return idle mUSD?
6. The backend loses its RPC connection. May the frontend silently show fixture metrics as if they
   were current onchain data?
7. A fresh Anvil instance starts. Can the previous `deployments/31337.json` addresses be assumed valid?
8. A developer proposes distributing newly minted SOLAR01 as lock rewards. Does that match the
   accepted model?

Added 2026-08-27:

9. An unregistered wallet connects and clicks Buy. What must the UI do before the wallet signs, and
   what revert would the contract produce if it did not?
10. The issuer deposits a large sinking-fund contribution that would support the floor moving up
    eight tick spacings. What happens on the first `levelUp()` call, and on the next?
11. The verifier marks NAV down by 15%. What happens to the published floor level, to the
    redemption price, and to pending level-ups?
12. A Hedera ATS bond wants to reuse ArcReserve's KYC decisions. What does it call, and can the ATS
    SDK drive `AssetToken` directly?

## Part B: Expected answer key

> Refreshed 2026-09-11 against `main` (contracts tasks 1-10, D-031/D-032, backend milestones A-E,
> frontend Milestone E). Grade against this version only.

1. It is a capped asset participation token. No automatic equity, title, guaranteed return, peg,
   principal protection, or unconditional legal claim should be asserted.
2. Solidity plus passing tests, then canonical system/decision docs, then other docs, then frontend
   copy/fixtures.
3. Spot, TWAP, verified NAV, protected floor reference, and redemption price.
4. No. It is a backing-aware reference and redemption remains liquidity- and mode-limited.
5. Current purchase transfers mUSD, immediately accounts it 65/30/5 (issuer/reserve/market,
   D-023), enforces per-class caps (D-028), and immediately mints tokens. Target flow escrows
   subscriptions and settles full/partial/failed outcomes atomically later.
6. No. Immutable `maximumSupply` and the mint check enforce the cap.
7. No. It has no issuance role and may use only transferred inventory.
8. Unminted capacity below the cap. It is neither issued nor circulating and does not enter backing or
   yield denominators.
9. Under D-031 the issuer receives no token allocation at all — nothing is minted at deploy, the
   issuer is paid in cash (65% of the raise + 10% operator share). `CompanyVestingWallet` exists
   only as an unused primitive; the yield-exclusion mechanism and the `issuerAllocation` flag
   (D-024) remain available but are unused in the demo.
10. `token.totalSupply() - revenue.excludedSupply()`.
11. Two separate mechanisms since D-024: a merely *yield-excluded* balance stays in issued and
    investor supply, so it still counts toward reserve and redemption obligations; an
    *issuer-allocation-flagged* balance leaves `investorSupply()` (the backing/redemption
    denominator) and can never redeem. The demo has neither.
12. They may participate only in deposits after becoming eligible, not earlier deposits.
13. The token calls the distributor before balance changes; sender and recipient revenue/debt are
    checkpointed using their pre-transfer balances.
14. On schedule: 60% holder pool (distributor), 25% reserve (vault), 10% operator accrual
    (distributor), 5% protocol fees (vault). While backing is behind the D-023 schedule the split
    shifts automatically to 40/45/10/5, evaluated live on every period-tagged deposit.
15. Redemption reserve, market-making allocation, asset revenue, issuer proceeds, protocol fees.
16. Only market-making allocation. It cannot withdraw redemption reserve.
17. Actual vault mUSD covers all accounted categories, and redemption reserve meets the NAV-derived
    minimum requirement.
18. `min(NAV, redemptionReserve / investorSupply)`, expressed per token (D-024); during the 90-day
    maturity window the payout is additionally capped at par (1.00).
19. Active, Matured, and Suspended/Defaulted respectively.
20. It reduces token obligations before releasing backing and prevents pay-without-burn ordering.
21. ReserveFloor for stable-biased lower market depth, Anchor for main two-sided liquidity, Discovery
    for token-biased price discovery, and Intermediary to bridge a material range gap.
22. Slide/sweep/discovery lifecycle and UX were adopted. Uncapped minting, bonding curve, and automatic
    protected-floor borrowing were rejected.
23. Remove all active liquidity for the target position, pass safety and range checks, update ticks,
    then remint explicitly in a second keeper transaction.
24. Slide requires spot above TWAP; sweep requires spot below TWAP.
25. Active/unmatured asset, fresh NAV (two-day registry default), spot/TWAP within 3%, TWAP/NAV within
    20%, solvent vault, and 30-minute cooldown for rebalances; max shift is 1,200 ticks.
26. Remove liquidity, collect fees, and return idle mUSD remain available for recovery. New risk
    actions are blocked.
27. Wallet writes are real when configured. Since Milestone E the marketplace and asset page read
    `/v1` with a provenance badge per panel; issuer/verifier/engine panels, issuer profile copy,
    keeper history, and the settlement/lock-and-earn previews are still fixtures. No API URL ⇒
    labelled fixture mode; a failing API ⇒ error state, never a fixture.
28. Recharts, now consuming `/v1` candles and drawing overlays from `/nav-history` + `/metrics`;
    on a fresh Anvil the chart is empty/`MOCK_DISABLED` until a keeper swap produces candles.
29. Since task 10 it emits canonical `Swap` events, so real `canonical_swap` candles exist after
    any swap — but it still has no price impact or tick crossing, so its candles record demo
    trades rather than price discovery.
30. Implemented (milestones A-E; see `backend/README.md`): idempotent per-block ingestion with
    block-hash checkpoints and cursor in one transaction, reorg rollback with candle rebuild,
    fresh-chain detection, 23 projections, `/v1` with the provenance envelope.

Scenario answers:

1. Show all three values separately: market 1.80, NAV 1.00, backing/floor 0.82. Maximum normal
   redemption reference is 0.82 before other limits.
2. Existing market inventory, then governed headroom issuance (20,000 unminted under D-031), then
   a new verified series. There is no vesting-release step any more, and the market manager must
   not mint.
3. (Now hypothetical — the demo has no vesting.) A formerly yield-excluded balance becomes
   eligible only for deposits after its exclusion is lifted; never retroactively.
4. No. Stale NAV stops guarded market funding, liquidity addition, swaps, and rebalances.
5. It cannot add. The keeper can remove and return idle mUSD.
6. No. Show stale/error state and preserve provenance.
7. No. Redeploy and refresh environment addresses.
8. No. Lock rewards should use realized mUSD revenue or fees, not inflationary asset-token rewards.

### Answers 31-40 and scenarios 9-12 (added 2026-08-27)

31. Both sender and recipient, unless that leg's account is `complianceExempt`. Only non-investor
    infrastructure (the canonical pool, the market manager — and any future vesting wallet, none
    deployed under D-031) may be exempt, set by the admin.
    No — exemption is per leg; the pool's payout leg still requires a verified recipient.
32. Transfer: no (`SenderNotVerified`). Sell into pool: no (same). Redeem: yes — burns skip the
    sender verification so principal is never trapped. Receive a forced transfer: only if the
    *recipient* is verified; expiry on the sender side is bypassed by the agent.
33. The custom-error selector of the first violated rule (pause, freeze, unfrozen balance, sender
    verification, recipient verification, compliance module) or `bytes4(0)` if allowed. The UI
    calls it before enabling Buy/Send/Redeem to show the reason instead of a raw revert.
34. 65% issuer proceeds / 30% protected reserve / 5% market allocation; backing ≈ 0.30 mUSD per
    investor token (plus any optional first-loss issuer deposit). Fresh capital is the 65%.
35. `targetBacking(t) = b0 + (1 − b0)·(t − t0)/(maturity − t0)`. Sources: settlement holdback,
    scheduled issuer contributions, 25–45% of revenue deposits, reserve yield, headroom issuance
    above par, realised ARC surplus (plus redemptions raising backing for the rest). Past grace:
    `ReserveShortfall` — issuer proceeds withdrawal and headroom issuance are blocked, verifier
    notified; 90 days is a default trigger.
36. Gross. Profit is issuer-controlled and hard to verify; gross (kWh × tariff) is externally
    verifiable, so the holders' claim cannot be diluted by cost accounting.
37. Any balance flagged `issuerAllocation` (D-024) — excluded from `investorSupply()` and barred
    from redeeming, because issuer-held tokens must never drain the investors' reserve. Under
    D-031 the demo flags nothing: the issuer holds no tokens at all.
38. Exactly one pool tick spacing (demo 60 ticks ≈ 0.6%). Anyone. `price(next tick) ≤ min(NAV,
    backing)` and the cooldown has elapsed. No — `redeem()` keeps paying the continuous
    `min(NAV, backing)`, which is always ≥ the level.
39. `keccak256(abi.encode(DeploymentParams))` must equal the `termsHash` stored at
    `approveAsset`; otherwise `beginAssetSystem` reverts with `TermsMismatch()`. Changing terms
    needs verifier re-approval. Since D-033 deployment is two transactions, and
    `completeAssetSystem` re-checks the hash **recorded at phase 1** rather than the registry's
    current one — so a `reapproveTerms` between the phases cannot swap the system being finished.
40. Anvil 31337, Base Sepolia 84532, Hedera testnet 296 — testnets only, `MockUSD` everywhere.
    Permits: mock stablecoin, one admin key per chain, unaudited, demo-labelled institutional flows.
    Forbids: mainnet, real funds, real investors, copy implying a regulated offering, and any
    lowering of the quality bar.

Scenarios:

9. Read `IdentityRegistry.isVerified` and `transferRestriction(0, wallet, amount)` (mint leg),
   show "not verified for this demo" with the registration path, and keep Buy disabled. Otherwise
   `RecipientNotVerified()`.
10. The floor moves up one tick spacing and the cooldown starts; nothing else. The next call
    succeeds only after the cooldown, again by one spacing — eight steps over eight cooldowns.
11. The level is capped by `min(NAV, backing)`; if the new NAV is below the current level the
    level does not move down while Active but no further level-ups occur until backing and NAV
    both cover the next tick. Redemption price becomes `min(newNAV, backing)` immediately.
12. It lists `AtsExternalKycList` (which wraps the registry as `getKycStatus`) in its
    `externalKycLists`. No — the ATS SDK drives ATS diamond facets and needs a mirror node;
    `AssetToken` is called through viem/ethers or `@hashgraph/sdk` contract calls.

## Automatic red flags

Do not authorize implementation until corrected if the agent says any of the following:

- SOLAR01 has or needs unlimited supply.
- Market price is NAV or guarantees redemption.
- The market manager should mint into discovery.
- Protected reserve can seed the market-floor position.
- Company vesting should earn current holder revenue while locked.
- Partial settlement gives all unsold tokens to the company.
- Current offering already escrows subscriptions.
- Current frontend candles are indexed or powered by TradingView.
- Mock pool tests prove real AMM economics.
- A paused system should make liquidity impossible to withdraw.
- Backend failures may silently fall back to believable mock numbers.

