# Manual operations runbook

Every action here has no UI, or a UI that is currently broken (see
`docs-handover/FRONTEND_INTEGRATION_PLAN.md`, section C, for the exact defects). Until those are
fixed, these are `cast`/`forge script` commands run by hand, from your own machine, using the
private key in `contracts/.env`. Nothing here touches the backend or the demo server — this is
pure contract interaction.

Confirmed 2026-09-13: the deployer key (`0xa2217C2C02086CD9169EFD68eBC52e763733CC05`) holds
`KEEPER_ROLE`, `VERIFIER_ROLE`, `REVENUE_DEPOSITOR_ROLE`, and is `issuer()` on Hedera. It deployed
both chains through the same process, so the same should hold on Arc — re-run the same `hasRole`
checks there if anything reverts with an access-control error.

## Setup

```bash
cd contracts
# PRIVATE_KEY and both RPC URLs already live in contracts/.env
RPC=$(grep -E "^HEDERA_TESTNET_RPC_URL=" .env | cut -d= -f2- | tr -d '"\r')   # Hedera 296
# or
RPC=$(grep -E "^ARC_TESTNET_RPC_URL=" .env | cut -d= -f2- | tr -d '"\r')     # Arc 5042002
CAST=C:/Users/willi/.foundry/bin/cast.exe
```

Addresses for every command below come from `contracts/deployments/296.json` and
`deployments/5042002.json` — read them fresh each time rather than copying values out of this
file, in case either chain gets redeployed.

**Gas on Hedera:** give any `cast send` an explicit `--gas-limit 1000000` for `swapExactInput`
specifically (see `docs-handover/PRODUCT_KNOWLEDGE.md` §7.5 — the wallet's own gas estimate can
land inside a band that reverts). Other calls (`slide`, `publishNAV`, etc.) haven't shown this and
don't need it, but it's harmless to add if one ever reverts mysteriously with no revert reason.

## 1. The market: two-way trading and the reserve-credit demo beat

**Use `ArmMarket.s.sol` for this — do not hand-compute ticks.** It reads the deployment JSON and
the pool itself, so it is always correct for whichever chain you point it at, unlike the
frontend's `engine-controls.tsx`, which has a hardcoded tick pair.

```bash
PRIVATE_KEY=$(grep -E "^PRIVATE_KEY=" .env | cut -d= -f2- | tr -d '"\r') \
  forge script script/ArmMarket.s.sol:ArmMarket --rpc-url $RPC --broadcast --slow
```

It is idempotent and self-describing — it prints what it did and what to do next:
- If the anchor is empty, it moves and funds the anchor, then tells you to run it again.
- **Wait out the rebalance cooldown (currently 1 second per the deploy scripts — effectively no
  wait), then run it again** to fund discovery. Two separate runs are required by design (the
  cooldown + one-timestamp-per-simulation issue documented in the script's own header).
- If both already hold liquidity, it says so and does nothing.

Run this any time a chain reports `pool.liquidity() == 0` or every swap reverts
`InvalidSwapDirection` — that means discovery got harvested down to nothing and never got
re-armed (Phase B-2, the automatic re-mint, is not built yet).

**The reserve-credit demo beat**, per Contract Arch's measured recommendation
(`PRODUCT_KNOWLEDGE.md` §7.7): after arming, do a few small trades, then one buy of **~400 mUSD**
to show `MarketSurplusCredited` live (measured: credits ≈86.35 mUSD, backing 4.359999 →
4.377269). Any single buy above ~137 mUSD blocks further buys until you re-arm — so treat that
400 mUSD buy as the last trade of that segment, then run `ArmMarket` again (twice, for the
cooldown) to reset before the next demo run. **Rehearse this reset on a fork first** — it has not
been exercised live yet.

## 2. Trading — `swapExactInput` (buy or sell, the D-037 path)

Two steps: approve the **manager**, not the pool, then swap.

```bash
MGR=<marketManager from deployments/<chainId>.json>
MUSD=<mockUSD from the same file>
TOKEN=<token from the same file>

# Buy: spend mUSD, receive SOLAR01
$CAST send $MUSD "approve(address,uint256)" $MGR 400000000 --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $MGR "swapExactInput(address,uint256,uint256,uint256)" \
  $MUSD 400000000 0 9999999999 \
  --private-key $PRIVATE_KEY --rpc-url $RPC --gas-limit 1000000

# Sell: spend SOLAR01, receive mUSD (18 decimals on the token leg)
$CAST send $TOKEN "approve(address,uint256)" $MGR <amount-18-decimals> --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $MGR "swapExactInput(address,uint256,uint256,uint256)" \
  $TOKEN <amount-18-decimals> 0 9999999999 \
  --private-key $PRIVATE_KEY --rpc-url $RPC --gas-limit 1000000
```

mUSD amounts are 6 decimals (400 mUSD = `400000000`); SOLAR01 amounts are 18 decimals.
`minAmountOut = 0` is a demo shortcut — never do this with real funds (see D-037 in
`docs/DECISIONS.md`). Passing `0` for `tokenIn`'s counterpart is not needed; the contract infers
direction from whether `tokenIn` matches `token0` or `token1`.

A partial fill refunds the unspent input automatically — your wallet's actual spend can be less
than `amountIn` if the pool runs out of depth on that side.

## 3. Judge self-registration and test funds

Both are permissionless — anyone's wallet can call these directly, no privileged key needed. Use
these to simulate what a judge does, or to fund a test wallet before rehearsing a demo trade.

```bash
DEMO_REGISTRAR=<demoRegistrar from deployments/<chainId>.json>
MUSD=<mockUSD from the same file>

$CAST send $DEMO_REGISTRAR "selfRegister()" --private-key <any wallet's key> --rpc-url $RPC
$CAST send $MUSD "faucet()" --private-key <any wallet's key> --rpc-url $RPC
```

Check first with `canSelfRegister(address)(bool)` — it returns `false` (silently a no-op if you
call `selfRegister` anyway) for a wallet already registered.

## 4. Verifier actions (your key, `VERIFIER_ROLE`)

```bash
REGISTRY=<registry from deployments/<chainId>.json>
ASSET_ID=<assetId from the same file>

# Publish a new NAV (6 decimals, e.g. 1.05 mUSD/token = 1050000)
$CAST send $REGISTRY "publishNAV(bytes32,uint256)" $ASSET_ID 1050000 --private-key $PRIVATE_KEY --rpc-url $RPC

# Approve a pending asset (only relevant if you submit a NEW asset via submitAsset first)
$CAST send $REGISTRY "approveAsset(bytes32,uint256,bytes32)" $ASSET_ID <initialNAV> <termsHash> \
  --private-key $PRIVATE_KEY --rpc-url $RPC

$CAST send $REGISTRY "suspendAsset(bytes32)" $ASSET_ID --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $REGISTRY "markDefault(bytes32)" $ASSET_ID --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $REGISTRY "markMatured(bytes32)" $ASSET_ID --private-key $PRIVATE_KEY --rpc-url $RPC
```

Republishing NAV is the only defense against staleness now (D-039 removed the on-chain guard —
see `docs/SECURITY.md`'s risk register). NAV goes stale ~2 days after the last publish; the
backend's `/v1/health` `risks[].navExpiresAt` tells you exactly when.

## 5. Issuer actions (your key, `issuer()` on the vault)

```bash
VAULT=<vault from deployments/<chainId>.json>
MUSD=<mockUSD from the same file>
REVENUE=<revenueDistributor from the same file>

# Sinking-fund contribution (D-023). periodId is a caller-chosen label, NOT validated on-chain —
# the verifier reconciles it against the term sheet off-chain. Use any incrementing integer.
$CAST send $MUSD "approve(address,uint256)" $VAULT <amount-6dp> --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $VAULT "depositReserve(uint256,uint256)" <amount-6dp> <periodId> --private-key $PRIVATE_KEY --rpc-url $RPC

# Revenue distribution. reportHash is any bytes32 -- for a demo, keccak256 of a label is fine.
REPORT_HASH=$($CAST keccak "demo-report-$(date +%s)")
$CAST send $MUSD "approve(address,uint256)" $REVENUE <amount-6dp> --private-key $PRIVATE_KEY --rpc-url $RPC
$CAST send $REVENUE "depositRevenue(uint256,uint256,bytes32)" <amount-6dp> <periodId> $REPORT_HASH \
  --private-key $PRIVATE_KEY --rpc-url $RPC
```

The frontend's `operator-forms.tsx` `depositRevenue` button is wired with the WRONG (1-argument)
signature and will revert — use this instead until that's fixed.

## 6. Reading state before you act

Always check these rather than assume, especially before a rebalance or a big trade:

```bash
MGR=<marketManager>
$CAST call $MGR "safetyState(bool)(uint8,uint256,uint256,uint256)" false --rpc-url $RPC
# 0 = None (clear to act). Any other code names the failing check. 4th value is NAV (6dp mUSD),
# not a tick -- confirmed against the struct return in AssetMarketManager.sol:545-549.

$CAST call $MGR "positions(uint8)(int24,int24,uint128,bool)" 1 --rpc-url $RPC  # 0=ReserveFloor,1=Anchor,2=Discovery,3=Intermediary
# 4th value is `configured` (bool), not a second liquidity figure -- Position struct, src/market/AssetMarketManager.sol:87-92.
$CAST call $MGR "principalOutstanding()(uint256)" --rpc-url $RPC
$CAST call $MGR "creditableSurplus()(uint256)" --rpc-url $RPC
$CAST call <pool> "liquidity()(uint128)" --rpc-url $RPC
```

Or just hit the deployed backend, which already computes most of this for you:
`https://arc-reserve-backend.talentor.tech/v1/health` (once DNS/TLS finish) or
`http://<server-ip>:4000/v1/health` today — `risks`, `rollbacks`, and each chain's indexer lag.

## What still has no manual flow written down

- Admin role grants / `setFloorController` / redeploying a component (e.g. what we did for Arc's
  DemoRegistrar tonight) — these are one-off `forge script` runs specific to the situation, not a
  repeatable command. Ask before improvising one; several of tonight's near-misses came from
  guessing at scripts like this without reading the target contract's actual state first.
- `executeSwap` (the keeper-only raw pool swap, distinct from `swapExactInput`) — no established
  reason to use it over the public path for demo purposes; documented in the contract but not
  covered here since nothing currently calls for it.
