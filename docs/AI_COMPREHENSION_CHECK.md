# AI Comprehension Check

Use this document before assigning material implementation work to a new AI agent. Ask the agent to
answer Part A without reading Part B during the response. The goal is to detect confident but incorrect
assumptions about financial boundaries, current implementation status, and demo data.

Recommended instruction:

> Read `CLAUDE.md` and every directly linked specification. Before changing code, answer questions
> 1-30 in your own words, identify three highest-risk misunderstandings, and state which requested
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

## Part B: Expected answer key

1. It is a capped asset participation token. No automatic equity, title, guaranteed return, peg,
   principal protection, or unconditional legal claim should be asserted.
2. Solidity plus passing tests, then canonical system/decision docs, then other docs, then frontend
   copy/fixtures.
3. Spot, TWAP, verified NAV, protected floor reference, and redemption price.
4. No. It is a backing-aware reference and redemption remains liquidity- and mode-limited.
5. Current purchase transfers mUSD, immediately accounts it 70/20/10, and immediately mints tokens.
   Target flow escrows subscriptions and settles full/partial/failed outcomes atomically later.
6. No. Immutable `maximumSupply` and the mint check enforce the cap.
7. No. It has no issuance role and may use only transferred inventory.
8. Unminted capacity below the cap. It is neither issued nor circulating and does not enter backing or
   yield denominators.
9. The vesting wallet contract, exclusion mechanism, tests, and local-script wiring exist. Factory and
   general offering settlement do not automatically create/register/fund vesting.
10. `token.totalSupply() - revenue.excludedSupply()`.
11. Yes. They remain issued supply even though excluded from revenue eligibility.
12. They may participate only in deposits after becoming eligible, not earlier deposits.
13. The token calls the distributor before balance changes; sender and recipient revenue/debt are
    checkpointed using their pre-transfer balances.
14. 60% holder pool in distributor, 25% reserve in vault, 10% operator accrual in distributor, and 5%
    protocol fees in vault.
15. Redemption reserve, market-making allocation, asset revenue, issuer proceeds, protocol fees.
16. Only market-making allocation. It cannot withdraw redemption reserve.
17. Actual vault mUSD covers all accounted categories, and redemption reserve meets the NAV-derived
    minimum requirement.
18. `min(NAV, redemptionReserve / current totalSupply)`, expressed per token.
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
27. Selected approvals, buy/claim/redeem, issuer/verifier writes, and keeper calls are real when
    configured. Most cards, OHLC, liquidity figures, profiles, activity, holdings, and settlement
    preview are fixtures.
28. Neither. It uses Recharts with custom candle shapes and static data.
29. It does not emit canonical swap-price events or move price as a real AMM would; it is a deterministic
    callback/oracle harness.
30. Create schema/config, ingest logs idempotently, checkpoint block hashes, roll back orphaned blocks,
    build derived read models, expose APIs, then aggregate canonical swap ticks/prices into candles.

Scenario answers:

1. Show all three values separately: market 1.80, NAV 1.00, backing/floor 0.82. Maximum normal
   redemption reference is 0.82 before other limits.
2. Existing inventory, scheduled vesting release, governed headroom issuance, then a new series. The
   market manager must not mint.
3. Eligible for the new deposit if release and exclusion accounting completed first; never eligible
   retroactively.
4. No. Stale NAV stops guarded market funding, liquidity addition, swaps, and rebalances.
5. It cannot add. The keeper can remove and return idle mUSD.
6. No. Show stale/error state and preserve provenance.
7. No. Redeploy and refresh environment addresses.
8. No. Lock rewards should use realized mUSD revenue or fees, not inflationary asset-token rewards.

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

