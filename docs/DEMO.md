# ArcReserve Hackathon Demo Runbook

This runbook separates visual storytelling from onchain proof. The UI contains deliberate fixtures;
do not describe every number on screen as live contract state.

## 1. Demo roles

Use Anvil accounts as follows:

| Account | Demo role |
| --- | --- |
| Anvil #0 | Issuer, verifier, protocol admin, keeper, revenue depositor. Registered as institutional |
| Anvil #1 | Investor. Registered as accredited (or whichever wallet `DEMO_INVESTOR` names) |
| Anvil #2 | Retail investor. Registered only so the 5,000 mUSD retail cap can be shown |

Copy private keys only from the local Anvil terminal. Never use Anvil keys on a public network.

## 2. Preflight

From the repository root, verify contracts:

```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe test
```

Expected baseline: **314 passed, 0 failed, 0 skipped** (2026-09-12).

The canonical-Uniswap fork suite is excluded from that run and is worth doing before a testnet
broadcast — it needs `BASE_SEPOLIA_RPC_URL` and takes under a second once the pinned block caches:

```powershell
$env:FOUNDRY_PROFILE="fork"; C:\Users\willi\.foundry\bin\forge.exe test
```

Expected: **9 passed**. See §13 for the full broadcast runbook.

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
$env:PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
forge script script/DeployLocal.s.sol:DeployLocal `
  --rpc-url http://127.0.0.1:8545 --broadcast
```

> **Pin the key explicitly — the plain command fails.** `DeployLocal` falls back to Anvil key #0
> only when `PRIVATE_KEY` is unset, and forge auto-loads `contracts/.env`, which carries the funded
> **testnet** deployer key. That key has no balance on Anvil, so the documented command without the
> pin dies with `insufficient funds for gas`. The value above is the well-known Anvil #0 key and is
> safe to paste — it is public, and `DeployLocal` refuses to run off chain 31337 anyway.

The script:

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
curve, with no tick crossing, fee growth or liquidity exhaustion. The API labels these
candles correctly: `source: "canonical_swap"` (the events are real) with `provenance: "mock"` (the
price is not). The chart badge follows once the frontend keys its badge and disclaimer on
`provenance` (Boundary C change log, 2026-09-11). Until that lands the chart still shows
**Derived** without the demo-feed disclaimer, so say the caveat out loud.

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

SOLAR01 is a permissioned token. The deploy script registers three wallets in the
`IdentityRegistry`, all in country 360 (Indonesia): Anvil #0 (deployer) as institutional, Anvil #1
(investor) as accredited, and Anvil #2 as retail. Connecting any other wallet will make every
purchase revert with `RecipientNotVerified()`. Investor classes are 1 retail, 2 accredited and
3 institutional; the `cast` example below registers a retail wallet. To use a different investor
wallet either set `DEMO_INVESTOR=0x...` before running the script, or register it afterwards from
account #0:

```powershell
cast send $env:IDENTITY_REGISTRY "registerIdentity(address,address,uint16,uint8,uint64)" `
  0xWALLET 0xWALLET 360 1 0 --rpc-url $env:RPC_URL --private-key $env:DEPLOYER_PRIVATE_KEY
```

**Faucet page (demo tool).** With the frontend dev server running, open
`http://localhost:3000/faucet.html` (or the port the dev server actually took). It has two paths:
"Mint with my wallet" (the connected wallet calls `faucet()`, +100,000 mUSD) and "Fund via Anvil #0"
(funds any typed address with any amount, no wallet needed — works only on local Anvil where the
dev accounts are unlocked). It also shows the recipient's mUSD balance and KYC status. This is a
static file in `frontend/public/`, deliberately outside the product UI.

Alternatively, use `cast` with the second Anvil account:

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
| Engine action reverts | Hardcoded ticks, no direction signal, cooldown, wrong token ordering. **Not a stale NAV — D-039 removed that gate** | Use focused Foundry tests or calculate live range |
| Price chart shows **Unavailable** | Nothing has traded and `ALLOW_MOCK_MARKET_DATA=false`, so `/candles` returns `503 MOCK_DISABLED` | Run §4.1, or restart the backend with `ALLOW_MOCK_MARKET_DATA=true` for the labelled synthetic feed |
| Keeper swap reverts | Output exceeds the pool's balance of the output token, slippage bounds, or an expired deadline. **No price gate remains** — the spot/TWAP gate went with D-036 and the spot/NAV gate with D-039 | Keep swaps at or below the §4.1 sizes; re-run §4.1 on a fresh chain if needed |
| `slide` / `sweep` revert `InvalidRange` and the buttons look dead | **Correct behaviour, not a fault.** Since D-036 they require spot to have LEFT the anchor band, and a fresh deployment starts mid-band | Trade until price exits the band, then slide/sweep |
| NAV age panel shows **stale** after day 2 | Expected. **Nothing breaks** — since D-039 NAV gates no engine action, and `SafetyCheckFailed(4)`/`(6)` can no longer be returned at all | Republish only to keep the UI tidy: `publishNAV(assetId, 1000000)`, a 0 bps move. Optional. See §13.5 |
| Engine behaves oddly after a large trade | An oversized swap on thin liquidity pinned price at the tick boundary. D-039 means this no longer locks the engine out — it keeps operating around a pinned price, which is quieter and easier to miss | Trade the price back; keep demo swaps modest. See §13.5 |
| Claim shows 142.80 without deployment | Fixture fallback | Do not describe it as live |

## 12. Closing proof

End with the automated evidence:

- **314 passing contract tests**, plus **9 fork tests against canonical Uniswap V3** on Base Sepolia;
- stateful financial invariants, including one proving a vault whose system was never finished can
  never take a deposit, driven by a prober holding every role that would normally authorise one;
- the market flywheel demonstrated against a **real** pool, not a mock — one trade moving the
  protected reserve 24,000 → 24,630.32 mUSD and backing 0.300000 → 0.307879; and
- clear separation between implemented MVP, visual fixtures, and target roadmap.

Do not describe mock pool behavior, fixture candles, escrow settlement, governed headroom, or lock and
earn as production-ready.

## 13. Testnet broadcast runbook (Base Sepolia)

Everything above is Anvil. This section is for putting a build on a public chain, and exists because
the first attempt burned 59 nonces and left 18 orphan contracts. Each step below is here because
something went wrong without it.

### 13.1 Gate before broadcasting

```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe test                       # expect 314 passed
$env:FOUNDRY_PROFILE="fork"; forge test; $env:FOUNDRY_PROFILE=""  # expect 9 passed
forge fmt --check
forge build --sizes                                              # record the runtime sizes, see 13.3
```

Then confirm, in order:

- `PRIVATE_KEY` in `contracts/.env` is the **funded** deployer. `DeployTestnet` requires it, has no
  fallback, and refuses all ten well-known Anvil keys when broadcasting.
- The deployer has balance. A full canonical run is roughly 47M gas, well under 0.001 ETH.
- `deployments/84532.json` will be **regenerated** — no need to clear it, but do not read addresses
  out of it beforehand. It is written during *simulation* too, so a stale copy can name addresses
  whose on-chain occupants came from an entirely different attempt.

### 13.2 Broadcast

```powershell
forge script script/DeployTestnet.s.sol:DeployTestnet `
  --rpc-url $env:BASE_SEPOLIA_RPC_URL --broadcast --slow
```

**`--slow` is not optional.** It serialises the sends, which keeps one transaction per block and
keeps the hash-to-function pairing in `broadcast/.../run-latest.json` trustworthy. Without it the
transactions batch and that file mis-labels them — observed attributing 108,442 gas to a call that
actually used 8,522,905.

Expect roughly 40–45 transactions, including exactly **two** factory calls: `beginAssetSystem`
(~8.5M gas) and `completeAssetSystem` (~10.3M). Deployment is two transactions by design (D-033) —
one call does not fit under Base's EIP-7825 cap or Hedera's. Total is around 47M gas, well under
0.001 ETH; the three `increaseObservationCardinalityNext` calls that used to cost ~20M are gone
with the TWAP (D-036), and a canonical pool now sits at observation cardinality 1 permanently.
That is intended — there is no oracle consumer left — so do not "fix" it by re-adding ring growth.

### 13.3 Verify against the chain, not against the broadcast file

**First, a trap that costs you the live address record.** A **dry run overwrites
`contracts/deployments/<chainId>.json`.** `_writeDeployment` runs in simulation exactly as it does
in a broadcast, so `forge script DeployTestnet` with no `--broadcast` silently replaces the live
deployment record. Consequences, all observed on 2026-09-12:

- Simulate and walk away, and the file now describes a system that does not exist. Every stack
  reads addresses from that file.
- The only reason it is recoverable is that the file is **committed**. Commit it before you
  simulate, or the live addresses exist nowhere but the chain.
- **Do not reason about whether a deployment is real from the addresses in that file.** Contract
  addresses are deterministic from `(deployer, nonce)`, so a dry run and a later real broadcast
  from the same nonce produce **byte-identical addresses**. "These look like my simulated
  addresses" is not evidence the deploy did not happen, and the reverse is equally unsound. This
  cut both ways in one session: a simulation's output was mistaken for the live record and nearly
  deleted, and later the live record was mistaken for simulation output and reverted.
- The absence of a real `broadcast/<script>/<chainId>/run-latest.json` alongside `dry-run/` is
  weak evidence at best — artifacts can be written elsewhere or cleaned.
- **A misdirected BROADCAST overwrites `run-latest.json` too, not just a dry run.** On 2026-09-13 a
  Uniswap factory meant for Arc landed on Hedera, so `broadcast/DeployUniswapFactory.s.sol/296/
  run-latest.json` now records the STRAY factory `0xe87b5f3a…`; the live `0x96f77b63…` survives only
  as the older `run-1789209532989.json`. It is deliberately NOT rewritten: `run-latest` means "most
  recent run", which is accurate, and `forge script --resume` reads it. Which factory is live is
  answered by `deployments/<chainId>.json` (`poolFactory`) and on chain by `getPool` for the asset's
  pair — never by `run-latest`. (`broadcast/` is gitignored, so this is local-machine state only.)

**The only authority is `eth_getCode`.** Settle it with the size check in item 1 below, which is
positive evidence of *which build* is live rather than evidence that something exists.

Then treat `run-latest.json` as a source of transaction *hashes* only, and verify everything else
by recipient and selector:

| | selector |
| --- | --- |
| `beginAssetSystem` | `0x96930be7` |
| `completeAssetSystem` | `0x2f424ba5` |

Checks worth doing every time:

1. **Byte-identical runtime check** — `forge build --sizes` locally, then `cast code <addr>` on
   chain, and compare lengths. If they match, the live system provably *is* the build you reviewed.
   This is otherwise assumed and never verified. As of 2026-09-12 after D-039: `AssetFactory`
   19,561 B, `AssetMarketManager` **17,858 B** (was 18,289 before D-039), `AssetVault` 12,486 B,
   `DemoRegistrar` 1,308 B — re-read them from `--sizes` rather than trusting these numbers, which
   move with every change.
   **Prefer this over probing for a removed getter.** "`maxMarketNAVDeviationBps()` reverts" is
   absence-of-the-wrong-code; a size match is presence-of-the-right-code, and it distinguishes two
   builds that both lack the getter. After D-039 the two live managers differed 17,858 vs 16,709,
   which settled which deployment was which in one call.
2. `AssetSystemDeployed` emitted **exactly once**, and `AssetSystemBegun` once, as **distinct**
   transactions.
3. `registry.statusOf(assetId) == 2` (Active), and all six `contracts_` match the JSON.
4. **D-032:** the factory holds no role on any component. Anything still held is a defect.
5. `pool.factory()` is the canonical V3 factory, fee 3000, and slot0's tick is within a tick or two
   of ±276324.
6. **Record `assetIsToken0`.** It is per-DEPLOYMENT, not per-chain, and moves with deployer nonce.
   It has now flipped **twice**: false → true, then true → **false** on the D-039 redeploy. Every
   tick-direction assumption downstream depends on it, so both other stacks must re-read it rather
   than carry a previous value forward.
   Two consequences that are easy to miss. **(a) It is a data hazard, not just a code hazard** —
   the backend derives ordering by address comparison at ingestion, so its code is correct, but
   rows already persisted under the old ordering are wrong. Wiping and reindexing after a redeploy
   is a **correctness requirement, not housekeeping**; "the old deployment is dead, the candles are
   harmless history" is the plausible-sounding reasoning that gets it wrong. **(b) 31337 and 84532
   now AGREE (both false), which is more dangerous than when they differed** — a latent ordering
   bug will look correct on both until the next redeploy flips it back, so cross-chain comparison
   no longer catches it. Test both orderings explicitly instead.
7. **Derive `START_BLOCK` for the backend** by binary search on historical `eth_getCode`, not from
   logs: Alchemy's free tier caps `eth_getLogs` at a **10-block** range and returns empty rather
   than erroring on a wider request, which looks exactly like "no events". Remember mUSD and the
   registry land **one block before** the factory, so use the earliest, not the factory's block.

### 13.4 Sequencing — the two traps

**`DemoRegistrar` — on a fresh run you do nothing.** `DeployTestnet` deploys it and grants it
`REGISTRY_AGENT_ROLE` as part of the same broadcast, so a new chain is usable by a visiting wallet
immediately. Confirm it landed: `demoRegistrar` in the JSON, and `isActive()` true.

The standalone script exists for the *other* case — attaching the stub to a system that is **already
live**, without redeploying it and discarding every wallet already verified on it:

```powershell
forge script script/DeployDemoRegistrar.s.sol:DeployDemoRegistrar `
  --rpc-url $env:BASE_SEPOLIA_RPC_URL --broadcast --slow
```

It is idempotent — a registrar already attached to that registry is left alone rather than joined by
a second agent holding the same role. **The trap it carries: run it against the old registry and
then redeploy, and every judge who self-registered is stranded and the grant is wasted.** A redeploy
creates a *new* `IdentityRegistry`, so this script only ever runs against the registry that is
currently live.

**Cleanup on the old system comes last — after the new one is proven serving, not merely deployed.**
`closeAsset` fails `canIssue` immediately and kills buying. Run it while backend and frontend are
still repointing and you destroy the only demoable system during exactly the window you might need
to fall back to it. Order: deploy → backend green → frontend green → **a real purchase succeeds on
the new system** → then `closeAsset` and revoke `FACTORY_ROLE` from the dead factory.

### 13.5 Demo-day operations

Four things that will bite live and read as bugs:

- **NAV goes stale two days after deployment — and since D-039 that breaks nothing.** This used to
  be the single most dangerous demo-day failure: capital-moving paths reverted `SafetyCheckFailed(4)`
  while buying and claiming kept working, so it presented as a broken engine rather than an expired
  oracle, and the flywheel turned exactly once before reporting
  `FlywheelSkipped("NO_DISCOVERY_LIQUIDITY")` forever. **None of that happens now.** NAV gates no
  engine action; codes 4 and 6 can no longer be returned at all. Republishing
  `publishNAV(assetId, 1000000)` (a 0 bps move) is now **optional housekeeping** — it keeps the NAV
  age panel green and the redemption quote honest. Worth doing on the morning of a demo; no longer
  the thing that decides whether the demo works.
- **`contracts/.env` is shared by every chain — a factory address in it belongs to ONE chain.**
  Pass `UNISWAP_V3_FACTORY` explicitly on every `DeployTestnet` run. With one deployer key, the same
  address holds DIFFERENT contracts on different chains: the Hedera Uniswap factory's address on Arc
  is an unrelated 13,958-byte contract. Both deploy scripts therefore verify the factory functionally
  (`feeAmountTickSpacing(3000) == 60`) rather than by bytecode size, which a large enough wrong
  contract would pass. `DeployLocal` ignores the `.env` alias entirely, so on Anvil "unset" means mock.
- **On Hedera, `cast send` needs an explicit `--gas-limit`.** Measured 2026-09-12: a
  `swapExactInput` that consumes ~2.25M gas on Anvil was estimated by Hedera's `eth_estimateGas`
  at **563,841**, and the transaction reverted out of gas with `gasUsed` equal to the limit and
  **no reason string** — so it reads as a contract bug rather than a gas problem. `eth_call` on the
  identical parameters succeeded and returned a sensible output, which is how you tell the two
  apart in one command. Re-sent with `--gas-limit 4000000` it succeeded using 469,867.
  `forge script` is NOT affected: it applies its own estimate times a multiplier, which is why the
  45-transaction deployment worked. **Any manual keeper action on 296 via `cast send` needs an
  explicit gas limit.**
- **`slide` / `sweep` are uncallable mid-band**, correctly. Trade the price out of the anchor range
  first, or explain it as "price is inside the range, no rebalance needed".
- **Keep swaps modest.** An oversized order against thin liquidity pins price at the tick boundary.
  Measured: 40,000 mUSD against ~1,350 mUSD of liquidity did exactly that. It no longer locks the
  engine out — D-039 removed the `MarketNAVDeviation` gate that used to trip — so the failure is now
  quieter: the engine keeps working around a price pinned at an extreme, and the chart looks wrong
  rather than the buttons looking dead.
- **The flywheel is no longer Base-only (2026-09-12).** It used to be: the mock pool has no curve,
  so a position's composition never converts, no surplus can arise, and the engine correctly
  reports `FlywheelSkipped("NO_SURPLUS")`. That is still true of the mock. But real v3-core can now
  be deployed to Anvil and used instead:

  ```powershell
  # 1. one-time, in the oprek-uniswap kit
  cd oprek-uniswap/oprek-uniswap/v3-periphery
  ./scripts/bootstrap.sh
  RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=<anvil#0> node scripts/deploy.js   # prints v3CoreFactory

  # 2. point ArcReserve at it
  cd arc-reserve/contracts
  $env:UNISWAP_V3_FACTORY="<v3CoreFactory>"; $env:DEMO_SEED_LIQUIDITY="true"
  forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --slow
  ```

  Measured on Anvil against real Uniswap: a 300 mUSD buy through `swapExactInput` moved the reserve
  32,000.000000 → 32,299.999998, backing 0.800000 → 0.807499, and ratcheted the floor one tick
  spacing. The 2-base-unit shortfall is Uniswap rounding position accounting down — the same
  direction, and the same magnitude, as on the Base Sepolia fork.

  **Two things that will make it look broken if you get them wrong**, both learned the hard way:
  - **Size the trade to the liquidity.** 5,000 mUSD against a single ~2,000 mUSD position consumed
    every tick above spot and pinned the price at MAX_TICK (887272). Nothing reverts — D-039
    removed the guard that used to — so the chart simply goes absurd. Start at a few hundred mUSD.
  - **Seed discovery only, and understand why.** `creditableSurplus()` is
    `max(0, mUSD balance − principalOutstanding)`, so mUSD deployed into a position leaves the
    balance while staying in the basis: the manager reads as under water and credits **zero** until
    it earns the draw back. Seeding the reserve floor (stable-only) or the anchor (both sides)
    therefore makes the first trades credit nothing — correct, conservative, and invisible in a
    demo. Discovery costs asset only, so the drawn mUSD stays free and the first buy converts
    inventory straight into surplus. `DeployLocal` does this for you on the real-pool path.

Cooldowns are set for demo pacing, not production: rebalance **1 second**, floor level-up
**5 seconds**. One second rather than zero is deliberate — two rebalances in the same block still
trip `SafetyCheckFailed(8)`, so the refusal stays demonstrable.

### 13.6 What a green run still does not prove

**A fork does not enforce EIP-7825's per-transaction gas cap, nor Hedera's.** An 18.4M-gas
`deployAssetSystem` passed every fork rehearsal before being refused at precheck on the real chain.
Fork tests prove logic and liquidity math. They say nothing about whether a transaction will be
accepted for broadcast — only a real send does that, which is why `--slow` and the post-broadcast
checks above exist.

