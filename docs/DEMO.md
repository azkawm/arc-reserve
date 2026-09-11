# ArcReserve Hackathon Demo Runbook

This runbook separates visual storytelling from onchain proof. The UI contains deliberate fixtures;
do not describe every number on screen as live contract state.

## 1. Demo roles

Use Anvil accounts as follows:

| Account | Demo role |
| --- | --- |
| First Anvil account | Issuer, verifier, protocol admin, keeper, revenue depositor, vesting beneficiary |
| Second Anvil account | Investor |

Copy private keys only from the local Anvil terminal. Never use Anvil keys on a public network.

## 2. Preflight

From the repository root, verify contracts:

```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe test
```

Expected baseline: 56 passed, 0 failed, 0 skipped.

Verify the frontend separately:

```powershell
cd ..\frontend
npm run typecheck
npm run lint
npm run build
```

## 3. Start the chain

Terminal 1:

```powershell
anvil
```

Keep this terminal running. Restarting Anvil without state persistence invalidates every previous
address.

Start it from a normal terminal, not from an agent tool session. An Anvil launched by an agent is
killed when that session's processes are cleaned up, which surfaces later as `fetch failed` /
`ECONNREFUSED` on 8545 rather than as an obvious crash.

## 4. Deploy and seed

Terminal 2:

```powershell
cd contracts
forge script script/DeployLocal.s.sol:DeployLocal `
  --rpc-url http://127.0.0.1:8545 --broadcast
```

The first Anvil key is used by default. The script:

1. deploys mUSD, registry, pool factory, component deployers, and factory;
2. submits and approves Solar Indonesia 01 at 1.000000 mUSD NAV;
3. deploys token, vault, offering, revenue, redemption, pool, and market manager;
4. activates the asset and hands component administration to the first account;
5. registers the demo identities and mints nothing: total supply starts at zero (D-031);
6. configures reserve-floor, anchor, and discovery ranges; and
7. deposits 20,000 mUSD into protected reserve.

Addresses are printed and written to `contracts/deployments/31337.json`. There is no
`companyVesting` key any more: D-031 removed the issuer token allocation.

### 4.1 Make the price chart real (do this before presenting)

On a fresh deploy nothing has traded, so there is no price history. With the backend's default
`ALLOW_MOCK_MARKET_DATA=false`, `GET /v1/assets/:assetId/candles` returns `503 MOCK_DISABLED` and the
asset page's chart shows **Unavailable**. That is deliberate (an empty chart is indistinguishable
from "never traded"), but it is not what you want on stage.

**Recommended: real swaps through the demo pool.** Since contracts task 10 the mock pool emits
canonical `Swap` events, and the backend turns them into `canonical_swap` candles with no config
change. A single keeper swap after a *default* deploy does not work: the market maker holds no
inventory until the deploy is seeded, and the seeded pool holds only 1,000 base units of each token,
so any swap large enough to move the price reverts. Deploy with seeding instead of the command above:

```powershell
cd contracts
$env:DEMO_SEED_LIQUIDITY = "true"
forge script script/DeployLocal.s.sol:DeployLocal `
  --rpc-url http://127.0.0.1:8545 --broadcast
Remove-Item Env:DEMO_SEED_LIQUIDITY
```

Seeding makes one real 10,000 mUSD purchase, so supply is no longer zero. Then, as the deployer
(Anvil #0 holds `KEEPER_ROLE`), deepen the anchor position and make three swaps. Each swap is sized
below the pool's balance of the token it pays out:

```powershell
$mm = (Get-Content deployments/31337.json | ConvertFrom-Json).marketManager
$rpc = "http://127.0.0.1:8545"
$from = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
$deadline = [int](cast block latest -f timestamp --rpc-url $rpc) + 3600
cast send $mm "addLiquidity((uint8,uint128,uint256,uint256,uint256,uint256,uint256))" "(1,100000000,200000000,200000000,0,0,$deadline)" --unlocked --from $from --rpc-url $rpc
cast send $mm "executeSwap((bool,int256,uint160,uint256,uint256,uint256))" "(true,60000000,4295128740,60000000,0,$deadline)" --unlocked --from $from --rpc-url $rpc
cast send $mm "executeSwap((bool,int256,uint160,uint256,uint256,uint256))" "(false,30000000,1461446703485210103287273052203988822378723970341,30000000,0,$deadline)" --unlocked --from $from --rpc-url $rpc
cast send $mm "executeSwap((bool,int256,uint160,uint256,uint256,uint256))" "(true,50000000,4295128740,50000000,0,$deadline)" --unlocked --from $from --rpc-url $rpc
```

Expected: every `cast send` reports `status 1 (success)` and the pool tick moves 276324 → 276319.
The backend indexes the swaps within a second; `/candles?interval=60` then returns one
`canonical_swap` bar near 1.0003–1.0005 mUSD with three trades.

**Say this out loud when you show the chart.** These are real onchain swap events, but the pool is
a demo AMM: its price moves by a linear stand-in (60 ticks per 1,000 mUSD of input), not an impact
curve, with no tick crossing, fee growth or liquidity exhaustion. The chart currently badges these
candles **Derived** and does not show the demo-feed disclaimer. That is a known labelling gap
(`docs/stacks/HANDOFF_LOG.md`, 2026-09-11 backend entry), so the presenter has to carry the caveat.

**Fallback: synthetic feed.** If you cannot run the swaps, restart the backend with
`ALLOW_MOCK_MARKET_DATA=true`. The chart then shows a deterministic synthetic series badged **Mock**,
with its disclaimer. Use this only if the swap path fails.

## 5. Configure the frontend

```powershell
cd ..\frontend
Copy-Item .env.example .env.local
```

Populate every address and asset ID from the new deployment. The pool and company vesting addresses
are not currently frontend environment fields.

Start the UI:

```powershell
npm run dev
```

Open `http://localhost:3000` and connect the intended Anvil wallet.

## 6. Fund the investor with demo mUSD

SOLAR01 is a permissioned token. The deploy script registers only Anvil account #0 (deployer) and
Anvil account #1 (investor) in the `IdentityRegistry`. Connecting any other wallet will make every
purchase revert with `RecipientNotVerified()`. To use a different investor wallet either set
`DEMO_INVESTOR=0x...` before running the script, or register it afterwards from account #0:

```powershell
cast send $env:IDENTITY_REGISTRY "registerIdentity(address,address,uint16,uint8,uint64)" `
  0xWALLET 0xWALLET 360 1 0 --rpc-url $env:RPC_URL --private-key $env:DEPLOYER_PRIVATE_KEY
```

There is no faucet button in the current UI even though the ABI includes `faucet()`. Use `cast` with
the second Anvil account:

```powershell
$env:RPC_URL = "http://127.0.0.1:8545"
$env:MUSD_ADDRESS = "0x..."
$env:INVESTOR_PRIVATE_KEY = "0x..."

cast send $env:MUSD_ADDRESS "faucet()" `
  --rpc-url $env:RPC_URL `
  --private-key $env:INVESTOR_PRIVATE_KEY
```

The unrestricted faucet is test-only and mints 100,000 mUSD to the caller.

## 7. What the audience may treat as live

When the correct wallet, chain, roles, and addresses are configured:

- mUSD approval to the offering;
- `PrimaryOffering.buy`;
- live claimable-revenue read;
- `RevenueDistributor.claimRevenue`;
- Normal-mode redemption;
- issuer reserve approval/deposit;
- revenue approval/deposit;
- asset submission;
- verifier NAV, suspend, default, and mature actions; and
- keeper range calls, subject to their current hardcoded tick limitation.

Transaction submission is live, but the UI does not yet wait for receipt/indexer confirmation before
showing its success message.

## 8. What must be described as demo/mock/preview

- Marketplace asset pipeline and protocol totals.
- Market price, TWAP, NAV age, floor, reserve, and supply cards in most pages.
- Candlestick history and timeframe changes.
- Position token composition and liquidity cards.
- Keeper history.
- Issuer company profile and documents.
- Investor holdings and market value.
- Sell preview/execution.
- Full/partial/failed settlement UI.
- Lock-and-earn panel.

The issuer page's 38,400/60,000 partial-settlement state is a target policy illustration, not a state
produced by the current offering.

## 9. Recommended presentation sequence

### Scene 1: Product boundary

Open `/`. Explain:

- capped asset series;
- verifier-controlled asset lifecycle;
- protected reserve;
- independent market price and NAV; and
- revenue and redemption utilities.

State immediately that the product does not automatically convey equity or guarantee redemption.

### Scene 2: Asset market UX

Open `/assets/solar-indonesia-01`. Present the candle chart as the intended TradingView-style UX, but
call it a mock feed. Point out the separate market, TWAP, NAV, and protected-floor overlays.

Explain that protected floor is a backing-aware reference, not a peg.

### Scene 3: Supply and company vesting

Show:

- 100,000 authorized cap;
- 20,000 company vesting fixture;
- circulating holder supply; and
- remaining unminted capacity.

Explain that local onchain vesting/exclusion exists, while the displayed later-state values are
fixtures and generic settlement wiring remains future work.

### Scene 4: Investor purchase

Connect the funded second account. In the Buy tab:

1. enter an amount within the wallet limit;
2. approve mUSD;
3. wait for approval confirmation in the wallet/explorer/terminal;
4. buy SOLAR01; and
5. verify balances with direct calls.

Disclosure: the UI's receive preview currently uses 1.018 mock market price, while the contract sale
price is 1.000000 mUSD. State the contract result, not the fixture preview, as authoritative.

### Scene 5: Revenue distribution

Switch to the first account and open `/issuer`:

1. approve mUSD to the revenue distributor;
2. deposit realized demo revenue; and
3. explain 60% holders, 25% reserve, 10% operator, 5% protocol.

Switch to investor and claim. The contract claim is transfer-aware and vesting-excluded.

### Scene 6: Redemption

Use the investor Redeem tab for Normal mode. Explain:

- quote is `min(NAV, liquid backing per token)`;
- period limit and reserve liquidity still apply; and
- token burns before mUSD release.

The displayed 0.82 estimate is a fixture. Verify the live quote with `cast call` before presenting the
actual payout.

### Scene 7: ARC Liquidity Engine

Open `/engine`. Use it primarily as visualization:

- market-floor range is not protected reserve;
- anchor is the main band;
- discovery is token-biased inventory; and
- intermediary bridges a gap.

The seeded deployment configures ranges but does not add actual liquidity. The displayed balances are
mock. Current engine buttons submit a fixed negative tick range and may revert for the actual token
ordering. Use the Foundry happy-path tests as onchain proof until controls are made orientation-aware
and dynamic.

Run:

```powershell
cd contracts
forge test --match-contract MarketMakingHappyPathTest -vv
forge test --match-contract AssetMarketManagerControlsTest -vv
```

### Scene 8: Verifier and emergency story

Open `/verifier` with the first account:

- publish a bounded NAV update;
- explain the 20% movement bound and two-day freshness threshold;
- show suspend/default/maturity controls; and
- explain that status changes stop normal issuance/market behavior.

The UI redeem action always uses Normal mode, so emergency redemption after default must be shown by
test or direct contract call until the UI exposes mode selection.

## 10. Direct verification calls

Set address variables from the fresh deployment:

```powershell
$env:RPC_URL = "http://127.0.0.1:8545"
$env:TOKEN = "0x..."
$env:VAULT = "0x..."
$env:OFFERING = "0x..."
$env:REVENUE = "0x..."
$env:REDEMPTION = "0x..."
$env:MARKET = "0x..."
```

Useful reads:

```powershell
cast call $env:TOKEN "totalSupply()(uint256)" --rpc-url $env:RPC_URL
cast call $env:TOKEN "maximumSupply()(uint256)" --rpc-url $env:RPC_URL
cast call $env:VAULT "redemptionReserve()(uint256)" --rpc-url $env:RPC_URL
cast call $env:VAULT "marketMakingAllocation()(uint256)" --rpc-url $env:RPC_URL
cast call $env:VAULT "totalAccounted()(uint256)" --rpc-url $env:RPC_URL
cast call $env:VAULT "isSolvent()(bool)" --rpc-url $env:RPC_URL
cast call $env:OFFERING "stablecoinRaised()(uint256)" --rpc-url $env:RPC_URL
cast call $env:REVENUE "circulatingSupply()(uint256)" --rpc-url $env:RPC_URL
cast call $env:REDEMPTION "redemptionPrice(uint8)(uint256)" 0 --rpc-url $env:RPC_URL
cast call $env:MARKET "marketPrices()(uint256,uint256,int24)" --rpc-url $env:RPC_URL
cast call $env:MARKET "safetyState(bool)(uint8,uint256,uint256,uint256)" false --rpc-url $env:RPC_URL
```

Base-unit output is expected: SOLAR01 uses 18 decimals; mUSD values use 6 decimals.

## 11. Demo failure recovery

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Contract call has no code | Stale addresses after Anvil restart | Redeploy and refresh `.env.local` |
| Write button disabled | Missing address or disconnected wallet | Populate all required env values and connect |
| AccessControl revert | Wrong Anvil account/role | Switch to the intended role account |
| Buy transfer failure | No mUSD or approval | Call faucet, approve, wait for confirmation |
| Revenue deposit reverts | No eligible supply, role, balance, or approval | Ensure investor purchase and correct depositor |
| NAV update reverts | More than 20% move or wrong status/role | Use bounded value and verifier account |
| Mark matured reverts | Maturity timestamp not reached | Demonstrate through test/time warp, not UI |
| Engine action reverts | Hardcoded ticks, no direction signal, cooldown, stale NAV, wrong token ordering | Use focused Foundry tests or calculate live range |
| Price chart shows **Unavailable** | Nothing has traded and `ALLOW_MOCK_MARKET_DATA=false`, so `/candles` returns `503 MOCK_DISABLED` | Run §4.1, or restart the backend with `ALLOW_MOCK_MARKET_DATA=true` for the labelled synthetic feed |
| Keeper swap reverts | Output exceeds the pool's balance of the output token, or spot drifted more than 3% from TWAP | Keep swaps at or below the §4.1 sizes; re-run §4.1 on a fresh chain if needed |
| Claim shows 142.80 without deployment | Fixture fallback | Do not describe it as live |

## 12. Closing proof

End with the automated evidence:

- 56 passing contract tests;
- five stateful financial invariants;
- 100% function coverage on `AssetMarketManager`; and
- clear separation between implemented MVP, visual fixtures, and target roadmap.

Do not describe mock pool behavior, fixture candles, escrow settlement, governed headroom, or lock and
earn as production-ready.

