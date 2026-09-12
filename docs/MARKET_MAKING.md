# ARC Liquidity Engine

The ARC Liquidity Engine is an Asset-Reserve Curve implemented as guarded Uniswap V3 concentrated
liquidity. It does not equate market price, verified NAV, or redemption value.

## Position model

| Position | Inventory bias | Purpose | MVP status |
| --- | --- | --- | --- |
| Market floor range | Primarily mUSD | Lower-range market depth funded only by the market allocation | Implemented and tested |
| Anchor | Two-sided | Main band around the reference market | Implemented and tested |
| Discovery | Primarily SOLAR01 | Controlled price discovery from transferred, capped inventory | Configurable and tested at the safety layer |
| Intermediary | Two-sided | Optional bridge across a material range gap | Configurable; manual keeper decision |

The manager has no issuance role. SOLAR01 inventory must be transferred into it, so rebalancing
cannot manufacture inventory. Protected reserve never enters the manager; the vault releases only
the separately accounted market allocation.

Funding therefore has two independent sources:

```text
mUSD inventory     <- AssetVault.marketMakingAllocation through keeper withdrawal
SOLAR01 inventory  <- explicit holder/treasury transfer through fundTokenInventory
```

Returning idle mUSD credits the market allocation again. It never credits or debits protected
reserve.

The market floor range is a liquidity position, not the protected floor reference. The protected
floor reference is derived from verified NAV and liquid reserve backing, while the market range can
move with trading conditions.

## Price inputs

Spot is read from pool `slot0`. **There is no TWAP (D-036).** `pool.observe` is never called, the
engine publishes no time-weighted price, and the spot/TWAP deviation gate is gone. `marketPrices()`
keeps its three-value shape for ABI stability but returns **0** in the `twapPrice` and `meanTick`
slots — deliberately 0 rather than spot, because a plausible number under a wrong label is the one
failure a consumer cannot detect. NAV and its timestamp come from the registry.

The engine therefore rejects stale NAV and **spot**/NAV deviation above its emergency threshold.
That is now the only market guard, and because it reads spot directly rather than a smoothed
average it reacts to a single trade. Expect it to fire more often than the old TWAP/NAV check did;
that is the trade D-036 made, not a regression.

The displayed redemption value comes from the redemption controller and is the lesser of its mode's
reference and liquid reserve backing per outstanding token. It is neither spot nor NAV.

## Operations

- `slide`: requires spot to have left the **anchor's own range on the upside**, then updates the
  empty anchor range.
- `sweep`: requires spot to have left the anchor range on the **downside**, then updates it.
- `refreshDiscovery`: updates the discovery target range.
- `rebalanceToNAV`: gradually changes the anchor after a verified NAV update.

### The flywheel (D-035, Phase B-1)

`swapExactInput(tokenIn, amountIn, minAmountOut, deadline)` is the **permissionless trading entry
point** — the public buys and sells through the manager rather than the pool directly. After the
trade settles, the crank turns:

```
buyer takes SOLAR01 out of the discovery range   →  the pool converts that inventory to mUSD
harvest discovery (burn + collect)               →  the proceeds become REAL, in the manager
creditMarketSurplus                              →  they cross into the PROTECTED RESERVE
backing per investor token rises                 →  canLevelUp() turns true
levelUp()                                        →  the published floor ratchets one spacing
```

Until this existed, **trading did nothing to backing** — the reserve only grew from issuer
deposits, the revenue split and yield. Measured on a canonical-Uniswap fork, one trade moved the
reserve 24,000 → 24,630.32 mUSD and backing 0.300000 → 0.307879, and the floor advanced.

Three things about it that are deliberate rather than incidental:

- **The harvest comes before the credit.** Proceeds from a converted position stay *inside* the
  position until it is burned, so burning is what realises them. Skip the harvest and there is
  nothing to credit.
- **Every post-trade step can fail silently**, reporting `FlywheelSkipped(reason)`. A trader's swap
  must never revert because the engine could not tidy up afterwards.
- **Unspent input is refunded.** A swap that exhausts liquidity stops at the price limit; left in
  the manager, the remainder would be indistinguishable from surplus and would be credited to the
  reserve — turning a trader's own money into backing.

The crossing is **one-way** (`MARKET_MANAGER_ROLE` only, nothing moves the reserve back toward
trading) and capped at `max(0, manager mUSD balance − principalOutstanding)`, so borrowed capital
can never be credited as earnings. Discovery is **not re-minted** after a harvest — that needs the
`L'` liquidity maths, which is the unbuilt half of D-035; a keeper refills with `addLiquidity`.

Each operation requires an active, unmatured asset; fresh NAV; acceptable price deviations; vault
solvency; a completed cooldown; tick-aligned ranges; and a bounded tick shift. Active liquidity must
be removed before a range changes. The keeper then remints explicitly with maximum inputs, minimum
received amounts, and a deadline. This two-transaction lifecycle is intentionally observable and
safe for the MVP, but exposes the strategy to an interval without active liquidity.

**The signal is the position's own range (D-036).** While spot sits inside the anchor band the
position is working on both sides and no rebalance is needed; once spot leaves it the position is
single-sided and the anchor must follow. That is the real trigger for repositioning concentrated
liquidity, it needs no oracle history, and it is self-contained — no NAV read, no stored reference.

Two consequences worth stating plainly:

- The comparison is made in **price** terms, not raw tick terms, and resolves through
  `assetIsToken0`: with the asset as token1 a higher price is a *lower* tick. The test suite proves
  the direction logic under **both** orderings, because `assetIsToken0` is false on Anvil and true
  on Base today and it has already flipped once.
- It is **stricter than the old TWAP signal**, which permitted a slide whenever spot exceeded the
  average even by a hair and even with price comfortably inside the range. Neither `slide` nor
  `sweep` is callable while spot is inside the band — including on a freshly deployed system, where
  spot starts at the centre. That is correct behaviour, not a dead button, but a UI must explain it.

Important implementation boundary, unchanged: the contract does not independently prove that the
keeper's proposed raw tick movement represents the same economic direction. It enforces tick
alignment and maximum shift. The keeper must calculate direction correctly. A production revision
should add an orientation-aware range-direction constraint or a policy-generated range.

## Default safety policy

| Control | Default |
| --- | ---: |
| Rebalance cooldown | 30 minutes (contract default); **the deploy scripts configure 1 second** |
| Maximum **spot**/NAV deviation | 2,000 bps |
| Maximum shift per endpoint | 1,200 ticks |
| Registry NAV stale threshold | 2 days |
| Registry NAV movement limit | 2,000 bps per update |

The TWAP window and the spot/TWAP deviation limit are **gone** (D-036). `setSafetyPolicy` still
takes five parameters so no caller has to re-encode, but the first and third are accepted and
ignored: they configure nothing, they are no longer validated so a caller may honestly pass `0`,
and they are emitted as `0`. Setting 1800 there does nothing.

The 1-second cooldown is deliberately 1 and not 0: two rebalances in the same block still trip
`SafetyCheckFailed(Cooldown)`, so the refusal stays demonstrable on a public chain, while a demo a
second apart runs freely.

The market safety check returns its first failure in this order: pause, inactive status, maturity,
stale NAV, **spot**/NAV deviation, reserve insolvency, and cooldown. `SafetyFailure` value **5**
(`SpotTwapDeviation`) is retained and **never returned**, so no consumer's failure-code mapping
shifts underneath it.

### Hikari reference and MVP happy paths

The lifecycle is informed by Hikari's `BasePriceAUSD` position management, specifically its
`slide`, `sweep`, and `drop` operations. ArcReserve adopts the observable range-management UX, not
Hikari's uncapped minting, bonding curve, automatic floor borrowing, or AMM math. ArcReserve keeps
issuance capped and requires previously transferred inventory for every position.

| Hikari concept | ArcReserve analogue | Deliberate difference |
| --- | --- | --- |
| `slide` | `slide` | No bonding curve, minting, or protected-floor borrowing |
| `sweep` | `sweep` | Does not automatically consolidate a calculated surplus into protected reserve |
| `drop` | `refreshDiscovery` | Keeper supplies bounded ticks; discovery is not auto-minted |
| `bump` | No direct equivalent | Protected-floor accretion requires a future realized-value accounting policy |

The external reference file is
`C:\Users\willi\Documents\works\ml\hikari\hikari-contract-v2\src\BasePriceAUSD.sol`. It is study
material only and is not a build dependency.

The contract integration suite locks in three keeper happy paths:

1. **Slide:** remove the active anchor after spot has left the band on the upside, move its range
   upward, and remint the same liquidity without disturbing the market-floor or discovery positions.
2. **Sweep:** remove the active anchor after spot has left the band on the downside, move its range
   downward, and remint it without losing manager inventory.
3. **Discovery refresh:** remove the discovery position, move it toward the rising market, and
   remint it while the anchor and market-floor positions remain funded.

Each path asserts configured ticks, manager and pool liquidity accounting, oracle direction,
rebalance timestamp, retained token and mUSD inventory, and unchanged protected redemption reserve.
This provides solid demo coverage while leaving adversarial and exhaustive range-combination testing
for the post-hackathon hardening phase.

## Verification matrix

| Area | Contract behavior verified |
| --- | --- |
| Roles | Keeper-only configuration, funding, liquidity, swaps, and rebalancing; admin-only policy and pause controls |
| Position configuration | Optional kinds, ordered and tick-aligned ranges, and refusal to reconfigure active liquidity |
| Vault separation | Market-allocation withdrawal and return reconcile exactly without changing the protected redemption reserve |
| Liquidity lifecycle | Configured-position requirement, bounded mint inputs, minimum removal proceeds, deadlines, and rollback on failure |
| Rebalancing | Active liquidity must be removed; slide/sweep direction, tick alignment, maximum shift, cooldown, and NAV rebalance are enforced |
| Safety state | Pause, inactive asset, maturity, stale NAV, spot/NAV divergence, vault insolvency, and cooldown are surfaced explicitly; the retired spot/TWAP code is asserted never to be returned |
| Floor level-up | A rebalance opportunistically advances the published floor; a controller that is unset, ineligible or reverting is skipped with a reason and never fails the rebalance |
| Swaps | Both token directions, exact callback accounting, maximum input, minimum output, nonzero amount, and deadline |
| Emergency recovery | Pause blocks new risk while existing liquidity can still be removed; unpause restores guarded operation |
| Fees | Only configured positions can collect; the no-accrual path returns zero without changing reserve accounting. On a **fork against real Uniswap**, fees accrued by genuine swaps are collected on the first call (the position is poked first), and remain collectable after the position is fully removed |

The focused suites are:

- `MarketMakingHappyPathTest`: Hikari-inspired slide, sweep, and discovery-refresh lifecycles.
- `AssetMarketManagerControlsTest`: role, accounting, safety, recovery, swap, configuration, and failure paths.
- `AssetMarketManagerTest`: price-source separation, callback authentication, basic liquidity, slippage,
  staleness, divergence, and cooldown checks.

The full Foundry suite must remain green alongside these focused tests. Coverage numbers are a useful
regression signal, not an audit or proof of economic correctness.

## Keeper runbook

### Before adding liquidity or swapping

1. Confirm the expected chain, asset ID, manager, and immutable pool.
2. Read asset status and maturity.
3. Read NAV and timestamp.
4. Read `safetyState(false)` and require `None`.
5. Confirm manager token0/token1 balances and the intended inventory source.
6. Calculate deadline, maximum inputs, minimum outputs, and price limit.
7. Simulate the exact transaction.

### Before rebalancing

1. Read `safetyState(true)` and require `None`.
2. Read token ordering and current position ticks/liquidity.
3. Determine economic price direction; do not assume increasing tick always means increasing
   stablecoin-per-asset price.
4. Remove the full target position with bounded minimum outputs.
5. Confirm recorded and pool liquidity are zero.
6. Submit the bounded range update.
7. Remint with explicit maximum input, minimum amounts, and deadline.
8. Confirm unrelated positions and protected reserve remain unchanged.

If the update succeeds but remint fails, the position remains empty. Recovery automation and alerts
are required before production.

### During an incident

After manager pause, do not attempt funding, adding, swapping, or rebalancing. The authorized keeper
may still remove liquidity, collect, and return idle mUSD to the vault. Record every recovery
transaction and reconcile manager/pool/vault balances.

## Indexer events

The backend should project:

- `PositionConfigured`;
- `PositionLiquidityAdded` and `PositionLiquidityRemoved`;
- `FeesCollected`;
- `Rebalanced`;
- `SwapExecuted`;
- `MarketAllocationFunded`;
- `TokenInventoryFunded`; and
- `SafetyPolicyUpdated`.

Manager events support audit and current range history. Canonical pool `Swap` events, not
`SwapExecuted` alone, are required for live OHLC because they include post-swap price/tick.

## Callback and execution safety

Mint and swap callbacks accept only the immutable pool and only while an exact manager-created
callback hash is active. They validate token0/token1, swap direction, positive owed side, and maximum
input. There are no arbitrary call targets or unbounded loops. All liquidity removal, fee collection,
range configuration, swaps, and rebalances emit detailed events.

The local demo uses `MockUniswapV3Pool` solely to exercise callbacks and oracle gates on Anvil. It is
not an AMM. A production deployment must use the canonical Uniswap V3 factory and pool, production
liquidity math, audited routing, and live manipulation-resistant oracle parameters.

The mock pool uses deterministic one-unit mint accounting and a fixed swap-output ratio. It does not
simulate tick crossing, price impact, fee growth per position, just-in-time liquidity, MEV, or
real-world liquidity exhaustion. Those behaviors require fork tests against the canonical pool.

Additional production gaps:

- no atomic remove/update/remint operation;
- no orientation-aware enforcement of proposed range direction;
- no automated range calculator or material-gap classifier;
- no automatic intermediary lifecycle;
- no fee-versus-principal ledger;
- no realized-surplus or floor-accretion controller;
- no keeper service, simulation pipeline, or alerting;
- no observation-cardinality provisioning; and
- no fork-tested behavior against the target canonical pool/factory.
