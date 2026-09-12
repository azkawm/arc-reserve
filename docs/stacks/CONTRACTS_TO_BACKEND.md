# Boundary B — Contracts → Backend / Indexer

What the Solidity layer emits and exposes for an event indexer and read-model service. Event
signatures are verbatim from `contracts/src/` as of 2026-08-27. Design of the backend itself is in
`docs/BACKEND_INDEXER.md`; this file is only the *input contract*.

## 1. Discovery and configuration

| Input | Source |
| --- | --- |
| Chain id | `31337` (Anvil) — verify against `eth_chainId` at startup |
| Root addresses | `contracts/deployments/<chainId>.json` → `arcReserve.registry`, `arcReserve.factory`, `arcReserve.mockUSD` |
| Per-asset component addresses | **Do not read from the JSON.** Derive from `AssetFactory.AssetSystemDeployed` (or `AssetRegistry.AssetContractsSet`) so multi-asset works |
| Yield-excluded addresses | Treat any address with `RevenueDistributor.YieldExclusionChanged(excluded=true)` as yield-excluded. **The `companyVesting` key no longer exists** — D-031 removed the issuer token allocation, so `DeployLocal` deploys no `CompanyVestingWallet`. Nothing is yield-excluded in the current demo seed |
| Mock yield source | `deployments.json → mockYieldSource` (demo only). Not emitted by any event; it holds `YIELD_SOURCE_ROLE` on the vault |
| ABIs | `contracts/out/<Name>.sol/<Name>.json` (`.abi`) after `forge build`; commit a copied `backend/abis/` snapshot so the backend does not depend on the Foundry cache |
| Start block | `0` on Anvil; on public chains the factory deployment block |

Watched address set = `{registry, factory, mockUSD} ∪ {token, vault, offering, revenueDistributor,
redemptionController, marketManager, pool}` per deployed asset (grow dynamically on
`AssetSystemDeployed`).

## 2. Event catalog (exact signatures)

Ordering key everywhere: `(blockNumber, transactionIndex, logIndex)`. Idempotency key:
`(chainId, transactionHash, logIndex)`.

### AssetRegistry
```solidity
event AssetSubmitted(bytes32 indexed assetId, address indexed issuer, string name, string category, string metadataURI, bytes32 metadataHash, uint64 maturityTimestamp);
event AssetStatusChanged(bytes32 indexed assetId, uint8 previousStatus, uint8 newStatus); // enum AssetStatus
event NAVUpdated(bytes32 indexed assetId, uint256 previousNAV, uint256 newNAV, uint64 timestamp);
event AssetContractsSet(bytes32 indexed assetId, (address token,address vault,address offering,address marketManager,address revenueDistributor,address redemptionController) contracts_);
event OraclePolicyUpdated(uint32 staleAfter, uint16 maxMovementBps);
```
`AssetStatus`: `0 Pending, 1 Approved, 2 Active, 3 Suspended, 4 Defaulted, 5 Matured, 6 Closed`.
`approveAsset` emits `NAVUpdated(assetId, 0, initialNAV, ts)` **and** `AssetStatusChanged(Pending→Approved)`.

### AssetFactory
```solidity
event PoolFactoryApprovalChanged(address indexed poolFactory, bool approved);
event AssetSystemBegun(bytes32 indexed assetId, address indexed issuer, address token, address vault, address offering, address revenueDistributor);   // D-033 phase 1
event AssetSystemAbandoned(bytes32 indexed assetId, address indexed caller);                                                                            // D-033
event AssetSystemDeployed(bytes32 indexed assetId, address indexed issuer, (address token,address vault,address offering,address marketManager,address revenueDistributor,address redemptionController,address pool) deployment);
```
**Discovery must stay on `AssetSystemDeployed`.** D-033 split deployment into two transactions, so
`AssetSystemBegun` announces four component addresses for a system that is not finished and may be
abandoned (`AssetSystemAbandoned`) — indexing those as live components would create an asset that
never reaches Active and whose addresses are then orphaned. `AssetSystemDeployed` is still emitted
exactly once, at completion, in its existing shape: **no backend change is required.** Index the
two new events only if the UI wants to show a deployment in progress.

### AssetToken (ERC-20 + roles)
```solidity
event Transfer(address indexed from, address indexed to, uint256 value);   // from==0 mint, to==0 burn
event Approval(address indexed owner, address indexed spender, uint256 value);
event RevenueDistributorSet(address indexed distributor);
event IssuerAllocationChanged(address indexed account, bool flagged, uint256 accountBalance);   // D-024
event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
event Paused(address account); event Unpaused(address account);
```
`totalSupply` projection = Σ mints − Σ burns; must equal `AssetToken.totalSupply()` at the block.
`investorSupply` = `totalSupply` − Σ balances of `IssuerAllocationChanged`-flagged addresses. Note a
flag change moves `investorSupply` with **no** `Transfer` — reproject on `IssuerAllocationChanged`
too. Under D-031 nothing is flagged in the demo, so `investorSupply == totalSupply`.

### AssetVault
```solidity
event AllocationChanged(bytes32 indexed category, int256 delta, uint256 newCategoryBalance, uint256 totalAccounted);
event InitialReserveDeposited(address indexed issuer, uint256 amount);
event IssuerProceedsWithdrawn(address indexed issuer, uint256 amount);
event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);
event RedemptionReleased(address indexed recipient, uint256 amount);
event MarketFundsReleased(address indexed marketManager, uint256 amount);
event MarketFundsReturned(address indexed marketManager, uint256 amount);

// D-023 sinking-fund reserve (added 2026-08-30)
event ReserveScheduleSet(uint256 startBacking, uint256 targetBacking, uint64 startTime, uint64 maturity, uint64 graceSeconds);
event ReserveContribution(address indexed issuer, uint256 indexed periodId, uint256 amount, uint256 newReserve);
event ReserveShortfallEntered(uint64 since, uint256 backing, uint256 targetBacking);
event ReserveShortfallCleared(uint64 clearedAt, uint256 backing, uint256 targetBacking);
event ReserveYieldAccrued(address indexed source, uint256 amount, bool creditedToReserve, uint256 newCategoryBalance);
event MaturityWindowSet(uint64 windowSeconds);
event ResidualReserveReleased(address indexed issuer, uint256 amount, uint256 obligationsRetained);
```
Backing values in these events are **6-decimal mUSD per investor token**, not totals.

Two of these move the reserve without a redemption, so a projection driven only by `Redeemed` will
drift: `ReserveYieldAccrued` (when `creditedToReserve`) credits it and `ResidualReserveReleased`
debits it. `AllocationChanged` remains the single reliable source for category balances.

`ReserveShortfallEntered` / `Cleared` are **published**, not authoritative: a shortfall can begin
with no transaction at all because the target rises with time. `shortfallSince` is only as fresh as
the last `syncShortfall`; `shortfallStartedAt()` is derived and always correct. Enforcement reads the
derived value, so absence of an `Entered` event does not mean the issuer gate is open.
`category` is a left-aligned bytes32 string literal: `"REDEMPTION_RESERVE"`, `"MARKET_ALLOCATION"`,
`"ASSET_REVENUE"`, `"ISSUER_PROCEEDS"`, `"PROTOCOL_FEES"`. **Projection rule:** apply `delta` to the
running category balance and assert it equals `newCategoryBalance`; on mismatch flag the row, never
overwrite silently. `AllocationChanged` is the single source for all five buckets; the other vault
events are annotations.

### PrimaryOffering
```solidity
event TokensPurchased(address indexed buyer, uint256 stablecoinAmount, uint256 tokenAmount, uint256 issuerShare, uint256 reserveShare, uint256 marketShare);
```
Same tx also emits three `AllocationChanged` (issuer, reserve, market) and one token `Transfer(0→buyer)`.

### RevenueDistributor
```solidity
// CHANGED 2026-08-30 (D-022/D-023): periodId, reportHash and behindSchedule were inserted BEFORE
// the amount fields. Regenerate the ABI rather than hand-patching a decoder.
event RevenueDeposited(address indexed depositor, uint256 indexed periodId, bytes32 reportHash, bool behindSchedule, uint256 grossAmount, uint256 holderAmount, uint256 reserveAmount, uint256 operatorAmount, uint256 protocolAmount);
event RevenueClaimed(address indexed holder, uint256 amount);
event OperatorRevenueClaimed(address indexed operator, uint256 amount);
event YieldExclusionChanged(address indexed account, bool excluded, uint256 accountBalance);
event RevenueSplitsSet((uint16 holderBps,uint16 reserveBps,uint16 operatorBps,uint16 protocolBps) onSchedule, (uint16,uint16,uint16,uint16) behindSchedule);
event ReportingPolicySet(uint64 periodSeconds, uint64 graceSeconds);
```
Holder + operator shares stay in the distributor; reserve + protocol move to the vault in the same
tx (two `AllocationChanged`). `excludedSupply` projection = Σ balances of excluded accounts,
updated on `YieldExclusionChanged` and on every `Transfer` touching an excluded account.

### RedemptionController
```solidity
event Redeemed(address indexed holder, uint8 indexed mode, uint256 tokenAmount, uint256 stablecoinAmount, uint256 nav, uint256 redemptionPrice); // mode: 0 Normal,1 Maturity,2 Emergency
event EmergencySettlementPriceSet(uint256 previousPrice, uint256 newPrice);
event RedemptionPeriodReset(uint64 startedAt);
```
Same tx: token `Transfer(holder→0)` **before** `RedemptionReleased` + `AllocationChanged(REDEMPTION_RESERVE, −amount)`.

### AssetMarketManager
```solidity
event PositionConfigured(uint8 indexed kind, int24 tickLower, int24 tickUpper);          // kind: 0 ReserveFloor,1 Anchor,2 Discovery,3 Intermediary
event PositionLiquidityAdded(uint8 indexed kind, uint128 liquidity, uint256 amount0, uint256 amount1);
event PositionLiquidityRemoved(uint8 indexed kind, uint128 liquidity, uint256 amount0, uint256 amount1);
event FeesCollected(uint8 indexed kind, uint256 amount0, uint256 amount1);
event Rebalanced(bytes32 indexed operation, uint256 spotPrice, uint256 twapPrice, uint256 nav, int24 anchorLower, int24 anchorUpper);
event SwapExecuted(bool indexed zeroForOne, uint256 amountIn, uint256 amountOut, uint160 sqrtPriceLimitX96);
event MarketAllocationFunded(uint256 amount);
event TokenInventoryFunded(address indexed funder, uint256 amount);
event SafetyPolicyUpdated(uint32 twapWindow, uint32 cooldown, uint16 spotTwapBps, uint16 marketNavBps, int24 maxTickShift);
```
```solidity
event FloorLevelUpSkipped(bytes32 reason);   // D-036; reasons below
```
**D-036 — two fields in the block above are now permanently 0.** `Rebalanced.twapPrice` and
`SafetyPolicyUpdated`'s `twapWindow` / `spotTwapBps` are retained so no decoder changes, but the
engine no longer has a TWAP and those values are always `0`. Do **not** store or serve them as
measurements — `market_rebalances.twap` should be null, not `0` rendered as a price. Emitting spot
there was considered and rejected: it would have stored a plausible number under a wrong label.

`FloorLevelUpSkipped` fires on the rebalance path when the opportunistic floor advance did not run.
Reasons: `NO_CONTROLLER`, `NOT_ELIGIBLE`, `CAN_LEVEL_UP_REVERTED`, `LEVEL_UP_REVERTED`. It is
informational, never an error — a rebalance still succeeded. A successful advance emits the
controller's own `FloorLevelUp` instead, so a rebalance can now produce a floor move with no
separate keeper transaction.

`operation` literals: `"SLIDE"`, `"SWEEP"`, `"REFRESH_DISCOVERY"`, `"REBALANCE_TO_NAV"`.
`Rebalanced` carries the anchor ticks even for `REFRESH_DISCOVERY`; read the moved range from the
`positions(kind)` state or the accompanying `PositionConfigured`-style effect (the manager updates
storage without a separate configured event on rebalance — verify with `positions()` at that block).
`amount0/amount1` are in **token0/token1 order**; use `assetIsToken0()` to label them.

### Canonical Uniswap V3 pool (production only)
```solidity
event Initialize(uint160 sqrtPriceX96, int24 tick);
event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);
event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);
event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1);
event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick);
```
**`MockUniswapV3Pool` emits none of these** and its `swap` does not move `sqrtPriceX96`. On Anvil,
OHLC must come from an explicitly `mock`-labeled synthetic adapter (gated by
`ALLOW_MOCK_MARKET_DATA=true`), never from `SwapExecuted` alone.

### AssetToken — compliance (added 2026-08-27)
```solidity
event IdentityRegistryAdded(address indexed identityRegistry);
event ComplianceAdded(address indexed compliance);            // zero address = compliance removed
event ComplianceExemptionChanged(address indexed account, bool exempt);
event AddressFrozen(address indexed userAddress, bool indexed isFrozen, address indexed owner);
event TokensFrozen(address indexed userAddress, uint256 amount);
event TokensUnfrozen(address indexed userAddress, uint256 amount);
event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent); // accompanied by a normal Transfer
```

### IdentityRegistry (protocol-wide, address from `deployments.json → identityRegistry`)
```solidity
event IdentityRegistered(address indexed investorAddress, address indexed identity);
event IdentityRemoved(address indexed investorAddress, address indexed identity);
event IdentityUpdated(address indexed investorAddress, address indexed newIdentity);
event CountryUpdated(address indexed investorAddress, uint16 indexed country);
event InvestorClassUpdated(address indexed investorAddress, uint8 investorClass);
event ClaimExpiryUpdated(address indexed investorAddress, uint64 expiresAt);   // 0 = no expiry
```
`registerIdentity` emits all four of `IdentityRegistered`, `CountryUpdated`, `InvestorClassUpdated`,
`ClaimExpiryUpdated` in that order. Derived `isVerified` = registered && (expiresAt == 0 || expiresAt > now)
— **time-dependent**, recompute at query time, do not store as a fact.

### ModularCompliance / modules (per token, addresses from `deployments.json`)
```solidity
event TokenBound(address indexed token);  event TokenUnbound(address indexed token);
event ModuleAdded(address indexed module); event ModuleRemoved(address indexed module);
// CountryAllowModule
event CountryAllowed(address indexed compliance, uint16 indexed country);
event CountryDisallowed(address indexed compliance, uint16 indexed country);
// TransferLockModule
event HoldPeriodSet(address indexed compliance, uint64 holdPeriod);
event HolderLocked(address indexed compliance, address indexed holder, uint64 lockedUntil);
```

### MockUSD (demo only)
```solidity
event FaucetUsed(address indexed account, uint256 amount);
```

## 3. Event → read-model map

| Read model | Built from | Validate against (at block) |
| --- | --- | --- |
| `assets` | `AssetSubmitted`, `AssetStatusChanged`, `AssetContractsSet`, `AssetSystemDeployed` | `registry.getAsset(id)` |
| `nav_history` | `NAVUpdated` | `registry.navOf(id)` |
| `supply` (issued / excluded / eligible) | token `Transfer`, `YieldExclusionChanged` | `token.totalSupply()`, `revenue.excludedSupply()`, `revenue.circulatingSupply()` |
| `holders` | token `Transfer` | `token.balanceOf(a)` |
| `vault_allocations` (5 buckets, history) | `AllocationChanged` | the five vault getters, `totalAccounted()` |
| `offering_purchases` | `TokensPurchased` | `stablecoinRaised()`, `tokensSold()`, `purchasedByWallet(a)` |
| `revenue_deposits`, `revenue_claims` | `RevenueDeposited`, `RevenueClaimed`, `OperatorRevenueClaimed` | `totalHolderRevenue()`, `totalClaimed()`, `operatorAccrued()` |
| `redemptions` | `Redeemed`, `EmergencySettlementPriceSet`, `RedemptionPeriodReset` | `totalRedeemedTokens()`, `totalStablecoinPaid()`, `redeemedThisPeriod()` |
| `position_configs`, `position_liquidity_events` | `PositionConfigured`, `PositionLiquidityAdded/Removed`, `FeesCollected` | `positions(kind)` |
| `market_rebalances` | `Rebalanced` | `lastRebalanceAt()` |
| `identities` (wallet → country, class, expiry, identity) | `IdentityRegistered/Removed/Updated`, `CountryUpdated`, `InvestorClassUpdated`, `ClaimExpiryUpdated` | `IdentityRegistry.getIdentity(a)` |
| `holder_restrictions` (frozen, frozenTokens, exempt, lockedUntil) | `AddressFrozen`, `TokensFrozen/Unfrozen`, `ComplianceExemptionChanged`, `HolderLocked` | `isFrozen(a)`, `getFrozenTokens(a)`, `isComplianceExempt(a)`, `lockedUntil(c,a)` |
| `compliance_config` | `ComplianceAdded`, `Module*`, `Country*`, `HoldPeriodSet` | `getModules()` |
| `manager_swaps` | `SwapExecuted` | — |
| `pool_swaps`, `candles` | canonical `Swap` (or synthetic adapter) | `marketPrices().spotPrice` |

Derived values the API computes (never store as "onchain"):
```
eligibleSupply          = totalSupply - excludedSupply
obligationsAtNAV        = totalSupply * nav / 1e18                       (6d)
minimumRequiredReserve  = obligationsAtNAV * minimumReserveRatioBps / 10_000
reserveRatioBps         = redemptionReserve * 10_000 / obligationsAtNAV  (∞ if 0 supply)
liquidBackingPerToken   = redemptionReserve * 1e18 / totalSupply          (6d; 0 supply → undefined)
redemptionPrice(Normal) = min(nav, liquidBackingPerToken)
```
Prefer calling `RedemptionController.redemptionPrice(0)` at the block and label it `onchain`.

## 4. Scales

| Value | Scale |
| --- | --- |
| Token amounts (`Transfer.value`, `tokenAmount`, `liquidity`-adjacent token amounts) | 18d |
| mUSD amounts, all vault buckets, all `*Share`, `stablecoinAmount` | 6d |
| `nav`, `newNAV`, `redemptionPrice`, `spotPrice`, `twapPrice`, `emergencySettlementPrice` | 6d mUSD per whole token |
| `sqrtPriceX96` | Q64.96; price = `(sqrtP/2^96)^2 * 10^(dec0−dec1)` |
| `liquidity` | raw `uint128`; never convert to amounts without a real curve |
| bps | `10_000 = 100%` |

Store raw base units as `NUMERIC`/`bigint`; format to decimal strings at the API edge.

## 5. Reorg and finality inputs

- Anvil: `CONFIRMATIONS=0` acceptable; block hashes still must be checkpointed so a restart
  with a fresh chain (all addresses change) is detected as "chain mismatch", not silently indexed.
- Detect fresh-Anvil restart: cursor block hash ≠ RPC block hash at that height **and** registry
  code at the configured address is empty → refuse to run and instruct to reset the DB.
- Public chains: choose `CONFIRMATIONS` per chain; serve provisional-tip data with `finalized:false`.

## 6. Roles and admin surface an indexer may want to track

Role hashes: `keccak256("VERIFIER_ROLE")`, `"ISSUER_ROLE"`, `"KEEPER_ROLE"`, `"REVENUE_DEPOSITOR_ROLE"`,
`"PAUSER_ROLE"`, `"FACTORY_ROLE"`, `"ISSUANCE_CONTROLLER_ROLE"`, `"REDEMPTION_CONTROLLER_ROLE"`,
`"ALLOCATOR_ROLE"`, `"MARKET_MANAGER_ROLE"`; `DEFAULT_ADMIN_ROLE = bytes32(0)`.

Note (corrected 2026-09-12): the factory **keeps nothing**. D-032 made `_handoffAdministration`
renounce every role each component's constructor gave it — `PAUSER_ROLE` on all six,
`KEEPER_ROLE` on the redemption controller and market manager, `REVENUE_DEPOSITOR_ROLE` on the
distributor, and `DEFAULT_ADMIN_ROLE` last — so a completed deployment ends with the factory
holding zero roles. (This paragraph previously said the opposite; that was stale from before
D-032.) An "admin activity" view **should** flag any role still held by a factory address after
`AssetSystemDeployed`.

Under D-033 the same is true of the abandon path: `abandonAssetSystem` renounces the factory's
roles on the four phase-1 orphans, so a `RoleRevoked` burst with no `AssetSystemDeployed` is an
abandoned deployment, not an anomaly.

## 7. Test fixtures the backend can reuse

- `forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast`
  produces a deterministic seed: 1 asset, **nothing minted** (D-031), 20,000 mUSD reserve, a D-023
  schedule (0.30 -> 1.00 over three years, 30-day grace), a 90-day maturity window, a 30/30-day
  reporting cadence, a `MockYieldSource` holding 5,000 mUSD, three configured positions with zero
  liquidity, no purchases.
- Replay acceptance (updated 2026-08-30): a fresh DB replaying that chain must yield
  `totalSupply = 0`, `investorSupply = 0`, `excludedSupply = 0`, `redemptionReserve = 20_000e6`, all
  other buckets `0`, status `Active`, NAV `1_000_000`. Prefer asserting against the contracts' view
  functions at the indexed block rather than hardcoded constants — these seed numbers have moved
  three times in one day.
- A 50,000 mUSD purchase then splits **65/30/5** (D-023): `issuerProceeds = 32_500e6`,
  `redemptionReserve = 35_000e6`, `marketMakingAllocation = 2_500e6`, backing `700_000`.
- Anvil accounts: #0 = issuer/verifier/admin/keeper/depositor; #1 = investor.

## 8. Change log

| Date | Change | Migration |
| --- | --- | --- |
| 2026-08-27 | Initial boundary snapshot | — |
| 2026-08-27 | **CHANGED** — compliance layer (D-021): new event sections for `AssetToken` compliance, `IdentityRegistry`, `ModularCompliance` + modules; three new read models; watched-address set gains `identityRegistry`, `compliance`, modules. | Add the new addresses to discovery; `isVerified` is time-dependent. |
| 2026-08-27 | **CHANGED** — company-token treatment (D-024). New `AssetToken` event `IssuerAllocationChanged(address indexed account, bool flagged, uint256 accountBalance)`. New views `investorSupply()`, `issuerAllocationSupply()`, `isIssuerAllocation(address)`. Backing, reserve ratio and redemption price are now denominated in investor supply. | Indexer: track flagged addresses from `IssuerAllocationChanged` and maintain `issuerAllocationSupply` from `Transfer` legs crossing the flag boundary; derive backing as `redemptionReserve / investorSupply`. A flag change moves backing with **no** `Transfer` event — reindex the derived view on `IssuerAllocationChanged` too. |
| 2026-08-27 | **CHANGED** — `RevenueDistributor.circulatingSupply()` renamed to `yieldEligibleSupply()`; the old name is kept as a deprecated alias returning the same value. | Backend: prefer `yieldEligibleSupply()`. Note it is a third distinct denominator: `totalSupply` ≠ `investorSupply` ≠ `yieldEligibleSupply`. |
| 2026-08-30 | **CHANGED** — task 10: canonical pool events. `IUniswapV3Pool` now declares `Initialize(uint160 sqrtPriceX96, int24 tick)` and `Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)` with v3-core's exact argument order, so they appear in the synced `MockUniswapV3Pool` artifact — you can drop the hand-written pool-events ABI if you prefer. `Swap` topic0 is asserted against `0xc42079f9…ca67` on our side too. `MockUniswapV3Pool` now moves `sqrtPriceX96`/`spotTick` on every swap and emits both; new views `totalLiquidity()`, `swapImpactUnit()`, `maxTickMovePerSwap()`. `AssetFactory` also now renounces every role it held, not just admin (D-032) — if you track role holders, the factory disappears from all six components. | Indexer: candles can flip from `mock` to `canonical_swap` with no backend change. Direction is canonical (zeroForOne lowers the tick); magnitude is a labelled linear stand-in, so keep the demo badge. `DEMO_SEED_LIQUIDITY=true` on `DeployLocal` makes a real 10,000 mUSD purchase and seeds an anchor position — that changes the replay fixture from "nothing has happened" to "one purchase has happened", so leave it off unless you want that. |
| 2026-08-30 | **CHANGED** — D-028 class-based subscription caps. New `PrimaryOffering` event `ClassLimitSet(uint8 indexed investorClass, uint256 walletLimit, uint256 aggregateCap)`. New views `classLimits(uint8) -> (uint256 walletLimit, uint256 aggregateCap, bool configured)`, `raisedByClass(uint8)`, `investorClassOf(address)`, `effectiveWalletLimit(address)`, `remainingAllowance(address)`. New errors `ClassWalletLimitExceeded()`, `ClassAggregateCapExceeded()`. No signature change to `buy`. **Demo identities changed**: the deployer is now institutional (3), Anvil #1 is **accredited** (2) rather than retail, and Anvil #2 is a new registered **retail** (1) wallet. | Indexer: `remainingAllowance(address)` is the correct per-account number and should replace a flat `walletPurchaseLimit` — it already folds in the class wallet cap, the class aggregate cap and the remaining raise. `effectiveWalletLimit` is the cap alone if you want both. For `/metrics.offering`, `classLimits(1..3)` plus `raisedByClass(1..3)` gives the full picture. A configured class limit **replaces** the global limit rather than stacking, and `type(uint256).max` means uncapped within the fundraising cap — render that as "uncapped", not as a huge number. |
| 2026-08-30 | **BREAKING** — D-026 term-sheet binding. `AssetRegistry.approveAsset(bytes32,uint256)` is now `approveAsset(bytes32 assetId, uint256 initialNAV, bytes32 termsHash)`. New `reapproveTerms(bytes32,bytes32)`, new view `termsHashOf(bytes32)`, new event `TermsApproved(bytes32 indexed assetId, bytes32 termsHash)`, new errors `AssetRegistry.InvalidTermsHash()` and `AssetFactory.TermsMismatch()`. The `Asset` struct gained a `termsHash` field **before** `status`, so `getAsset` tuple decoding shifts — regenerate the ABI. | Indexer: add `TermsApproved` to the catalog and to the asset read model; it fires on approval and on every amendment, so keep the latest. `termsHashOf` joins the pinned view surface in §9. Note the hash is frozen at deployment, so for any Active asset it describes the parameters actually deployed. |
| 2026-08-30 | **CHANGED** — D-025 published protected floor. New contract `FloorController` (`deployments/<chainId>.json` key `floorController`, added). Events: `FloorLevelUp(int24 previousTick, int24 newTick, uint256 floorPrice, uint256 backing, uint256 nav)`, `FloorLevelCooldownSet(uint64)`. Views: `floorTick()`, `floorPrice()`, `nextTick()`, `priceAtTick(int24)`, `ceilingParts()`, `canLevelUp()`, `isFloorCovered()`, `floorLevelCooldown()`, `lastLevelUpAt()`. `AssetMarketManager` gains `rebalanceToFloor(int24,int24)`, `setFloorController(address)`, event `FloorControllerSet(address indexed)`, errors `FloorControllerNotSet()` / `RangeAboveFloor()`, and a `REBALANCE_TO_FLOOR` operation on the existing `Rebalanced` event. | Indexer: add `floorController` to the watched set. `floorPrice` is 6-decimal mUSD, comparable with NAV and market price. **`isFloorCovered()` can go false with no event and no level change** — a NAV markdown leaves a valid level above the new NAV, and the ratchet pauses rather than retreating. Derive coverage from a live call, not from `FloorLevelUp` history. The published floor is a reference, never a bid, and `redeem()` is unaffected by it. |
| 2026-08-30 | **CHANGED** — D-023 settlement split. `PrimaryOffering` now splits **65/30/5** (was 70/20/10): `ISSUER_BPS` 6,500, `RESERVE_BPS` 3,000, `MARKET_BPS` 500. No signature or event change; the amounts in `TokensPurchased` and `AllocationChanged` simply move. | Indexer: nothing to change structurally, but any fixture asserting 70/20/10 will fail. A 50,000 mUSD purchase is now 32,500 / 15,000 / 2,500. |
| 2026-08-30 | **FIXED** — §2 event catalog was missing every event added by contracts tasks 1-6 (`IssuerAllocationChanged`, `ReserveScheduleSet`, `ReserveContribution`, `ReserveShortfallEntered`, `ReserveShortfallCleared`, `ReserveYieldAccrued`, `MaturityWindowSet`, `ResidualReserveReleased`, `RevenueSplitsSet`, `ReportingPolicySet`) and still showed the pre-D-022 `RevenueDeposited` signature. §1 still pointed at the removed `companyVesting` key and §7's replay fixture still described the D-031-removed vesting mint. All corrected. Reported by the backend agent, whose undecoded-log test caught `MaturityWindowSet`. | Indexer: re-read §1, §2 and §7. The catalog is the contract; if an event is missing from it, that is my bug — keep the undecoded-log assertion. |
| 2026-08-30 | **CHANGED** — D-023 residual return. New `AssetVault` views `maturityParValue()`, `maturityWindowEndsAt()`, `maturityWindowSeconds()`, `outstandingObligationsAtPar()`, `residualReserve()`; new write `releaseResidualReserve()` (issuer, at `Closed` after the window) and `setMaturityWindow(uint64)` (admin). New events `MaturityWindowSet(uint64)`, `ResidualReserveReleased(address indexed issuer, uint256 amount, uint256 obligationsRetained)`. New `RedemptionController` error `MaturityWindowClosed()`. | Indexer: maturity-mode redemptions are capped at par, so the paid price can be **below** `min(NAV, backing)` — do not reconstruct it from backing alone; read `redemptionPrice(1)`. `ResidualReserveReleased` debits `redemptionReserve` without a redemption, so a reserve projection driven only by redemption events will drift. |
| 2026-08-30 | **CHANGED** — D-023 reserve yield. New `AssetVault.accrueReserveYield(uint256)` under a new `YIELD_SOURCE_ROLE`, new event `ReserveYieldAccrued(address indexed source, uint256 amount, bool creditedToReserve, uint256 newCategoryBalance)`. New `deployments/<chainId>.json` key `mockYieldSource` (added, nothing renamed). | Indexer: `creditedToReserve` says which bucket grew — do not assume the reserve. Add `mockYieldSource` to the watched-address set for the demo. The routing depends on schedule state at accrual time, so it can differ between two identical-looking accruals. |
| 2026-08-30 | **BREAKING** — D-022/D-023 dynamic revenue split. `RevenueDistributor.depositRevenue(uint256)` is now `depositRevenue(uint256 amount, uint256 periodId, bytes32 reportHash)`. The `RevenueDeposited` event gained `periodId` (indexed), `reportHash` and `behindSchedule` **before** the existing amount fields — re-generate the ABI, do not hand-patch the decoder. The `HOLDER_BPS`/`RESERVE_BPS`/`OPERATOR_BPS`/`PROTOCOL_BPS` constants are **removed**; splits are now the `onScheduleSplit()` / `behindScheduleSplit()` structs. New events `RevenueSplitsSet`, `ReportingPolicySet`. New views `activeSplit()`, `reportingDueAt()`, `isReportingOverdue()`, `lastPeriodId()`, `lastRevenueDepositAt()`, `revenueByPeriod(uint256)`. | Indexer: the applied split varies per deposit — read it from the event, never recompute from constants. `behindSchedule` on the event tells you which variant ran. Period totals are `revenueByPeriod`; a period can receive multiple deposits. `isReportingOverdue` is time-derived like the shortfall, so it can become true with no transaction. |
| 2026-08-30 | **CHANGED** — D-023 reserve schedule on `AssetVault`. New events: `ReserveScheduleSet(startBacking, targetBacking, startTime, maturity, graceSeconds)`, `ReserveContribution(address indexed issuer, uint256 indexed periodId, uint256 amount, uint256 newReserve)`, `ReserveShortfallEntered(uint64 since, uint256 backing, uint256 targetBacking)`, `ReserveShortfallCleared(uint64 clearedAt, uint256 backing, uint256 targetBacking)`. New views: `reserveSchedule()`, `targetBackingAt(uint64)`, `targetBackingNow()`, `currentBacking()`, `isBehindSchedule()`, `shortfallStartedAt()`, `isInEnforcedShortfall()`, `shortfallSince()`. | Indexer: all backing values are **6-decimal mUSD per investor token**. Do not derive shortfall state from the events alone — a shortfall can begin with no transaction at all, because the target rises with time. Compute `isBehindSchedule` from indexed reserve + investorSupply against the stored schedule, or read `shortfallStartedAt()` (derived, always correct). `shortfallSince` is only as fresh as the last sync. A backend heartbeat calling the permissionless `syncShortfall()` keeps the event stream timely but is **not** required for enforcement. |
| 2026-08-30 | **CHANGED** — D-031: no issuer token allocation. `deployments/<chainId>.json` no longer contains the `companyVesting` key and no `CompanyVestingWallet` is deployed. Total supply is 0 at deploy; only `PrimaryOffering` ever mints. | Backend: `COMPANY_VESTING_ADDRESS` is already optional in `config.ts` and degrades gracefully — drop it from `.env`/`.env.example` and from the `watchedContracts` count when convenient. No `IssuerAllocationChanged` events will be emitted in the demo, so `investorSupply == totalSupply`. |
| 2026-09-12 | **CHANGED** — D-035 Phase B-1, the market flywheel. New `AssetVault` event `MarketSurplusCredited(address indexed marketManager, uint256 amount, uint256 newReserve)` and write `creditMarketSurplus(uint256)` (`MARKET_MANAGER_ROLE`, one-way). New `AssetMarketManager` events `SwapExactInput(address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut)`, `SurplusCredited(uint256)`, `FlywheelSkipped(bytes32 reason)`; new view `creditableSurplus()`; new state `principalOutstanding()`. | Indexer: **`redemptionReserve` can now grow from trading**, not only from issuer deposits, revenue and yield. A reserve projection driven solely by those three will drift — `MarketSurplusCredited` is a fourth source and also emits the usual `AllocationChanged(REDEMPTION_RESERVE, +amount)`. `SwapExactInput` is the manager-routed trade; note `amountIn` is the amount **requested**, and the swap may spend less and refund the rest, so derive actual spend from the pool's `Swap` event rather than from this field. `FlywheelSkipped` reasons: `NO_DISCOVERY_LIQUIDITY`, `NO_SURPLUS`, `CREDIT_REVERTED` — informational, the trade still settled. A `PositionLiquidityRemoved` for Discovery with no keeper transaction is the harvest, not an anomaly. |
| 2026-09-12 | **CHANGED** — `AssetMarketManager.collectFees` now pokes the position (zero-liquidity burn) before collecting, so accrued fees are actually attributed. No ABI change; `FeesCollected(kind, amount0, amount1)` is unchanged in shape. | Indexer: on a canonical pool `FeesCollected` will now carry **non-zero** amounts where it previously always reported `0, 0` — the fees existed, the call just could not reach them. On the mock (Anvil) it stays 0, because the mock has no fee growth at all, so a 0 there is not evidence of anything. If any projection or dashboard treats "fees collected = 0" as normal, that assumption is now wrong on Base. |
| 2026-09-12 | **CHANGED** — D-034 `DemoRegistrar`. New `deployments/<chainId>.json` key `demoRegistrar`. It holds `REGISTRY_AGENT_ROLE` on the `IdentityRegistry` and exposes one permissionless write, `selfRegister()`, which registers the caller as Indonesian retail with no expiry. New event `SelfRegistered(address indexed wallet, uint16 country, uint8 investorClass)` on the registrar. | Indexer: **no new decoding is required** — a self-registration emits the registry's existing `IdentityRegistered` / `CountryUpdated` / `InvestorClassUpdated` / `ClaimExpiryUpdated`, so the `identities` read model already covers it. Add `demoRegistrar` to the watched set only if you want to attribute registrations to the stub. Two operational notes: `identityCount` now grows without bound as visitors self-verify, so anything assuming a small fixed identity set should be reviewed; and a `RoleGranted(REGISTRY_AGENT_ROLE, …)` to a contract is expected here, not an anomaly. |
| 2026-09-12 | **BREAKING** — D-036, the TWAP is removed from the engine. **`AssetMarketManager.twapWindow()` and `maxSpotTwapDeviationBps()` no longer exist** — a call to either reverts. `marketPrices()` keeps its `(spotPrice, twapPrice, meanTick)` shape but the 2nd and 3rd values are **always 0**, never spot. `safetyState`'s 3rd return value is likewise always 0. `Rebalanced.twapPrice` and `SafetyPolicyUpdated`'s `twapWindow`/`spotTwapBps` fields are kept in the event ABI and always emit 0. `setSafetyPolicy` keeps five parameters but the 1st and 3rd are accepted, ignored and no longer validated (0 is now a legal value for them). `SafetyFailure.SpotTwapDeviation` **keeps enum value 5** and is never returned — do not renumber. `maxMarketNAVDeviationBps` now compares **spot** to NAV. New event `FloorLevelUpSkipped(bytes32 reason)`. | Indexer: **serve `twap` as `null`, never as `0` and never as an echo of spot** — a price of 0 is the contract saying "not published", and rendering it as a number is the exact failure this design avoided. `/metrics.marketStatus` must key on spot alone, or every deployment reports `warming_up` forever once twap is null. Drop `windowSeconds` from the twap payload; there is no window. Expect `MarketNAVDeviation` (code 6) to appear **more often** than the old TWAP-based check — it reads spot directly, so an ordinary large trade can trip it; that is expected behaviour, not an incident. Keep code 5 in your enum mapping as reserved so 6/7/8 do not shift. |
| 2026-09-12 | **CHANGED** — D-033 two-phase factory. `AssetFactory.deployAssetSystem(params)` is **retired** and replaced by `beginAssetSystem(params)` + `completeAssetSystem(bytes32 assetId, params)`, plus `abandonAssetSystem(bytes32)` and the view `isPending(bytes32)`. New events `AssetSystemBegun(bytes32 indexed assetId, address indexed issuer, address token, address vault, address offering, address revenueDistributor)` and `AssetSystemAbandoned(bytes32 indexed assetId, address indexed caller)`; new errors `AlreadyBegun()`, `NotBegun()`, `AssetIdMismatch()`. New `AssetVault` error `SystemNotActive()` on the three direct inflows while the asset is `Approved`. Also corrected §6, which wrongly claimed the factory keeps `PAUSER_ROLE`/`KEEPER_ROLE` after handoff — D-032 made it keep nothing. | **No backend change is required.** `AssetSystemDeployed` still fires exactly once, at completion, with its existing shape, so discovery and the `assets` read model are untouched. **Do not move discovery to `AssetSystemBegun`** — it announces four components for a system that is not finished and may be abandoned, which would create an asset that never reaches Active with orphaned addresses. Index the two new events only if you want to show a deployment in progress. One thing that *does* need doing: `backend/abis/AssetFactory.json` still lists `deployAssetSystem` — re-run `npm run sync-abis` after the next `forge build`. |

## 9. View surface the read API depends on (added 2026-08-30)

The backend serves live contract calls at the indexed block, so **a view rename is as breaking as an
event change**. Everything below is under the same `CHANGED`-row discipline as the event catalog.
Adding views is always safe; renaming, removing or changing a return shape is not.

| Contract | Views |
| --- | --- |
| `AssetRegistry` | `navOf`, `statusOf`, `maturityOf`, `issuerOf`, `isNAVStale`, `termsHashOf` |
| `AssetVault` — categories | `redemptionReserve`, `marketMakingAllocation`, `assetRevenue`, `issuerProceeds`, `protocolFees`, `totalAccounted`, `totalStablecoinBalance` |
| `AssetVault` — solvency | `minimumRequiredReserve`, `minimumReserveRatioBps`, `reserveRatioBps`, `isSolvent`, `availableRedemptionLiquidity` |
| `AssetVault` — D-023 schedule | `currentBacking`, `targetBackingNow`, `isBehindSchedule`, `isInEnforcedShortfall`, `shortfallStartedAt`, `reserveSchedule` |
| `PrimaryOffering` | the config getters (`tokenPrice`, `fundraisingCap`, `walletPurchaseLimit`, `inventoryCap`, `minimumPurchase`, `startsAt`, `endsAt`, `stablecoinRaised`, `tokensSold`, `availableTokenInventory`), plus `classLimits`, `raisedByClass`, `investorClassOf`, `effectiveWalletLimit`, `remainingAllowance` |
| `RedemptionController` | `redemptionPrice(mode)`, `outstandingTokenObligations`, and the period getters |
| `AssetMarketManager` | `marketPrices` (2nd and 3rd values always 0, D-036), `positions`, `assetIsToken0`, `tickSpacing`, `safetyState`; `rebalanceCooldown`, `maxMarketNAVDeviationBps`, `maxTickShift`. **`twapWindow()` and `maxSpotTwapDeviationBps()` are REMOVED** |
| `AssetToken` | `maximumSupply`, `investorSupply`, `issuerAllocationSupply` |
| `FloorController` | `floorTick`, `floorPrice`, `nextTick`, `priceAtTick`, `ceilingParts`, `canLevelUp`, `isFloorCovered`, `floorLevelCooldown`, `lastLevelUpAt` |
| `RevenueDistributor` | `yieldEligibleSupply`, `excludedSupply`, `claimableRevenue` |

Two time-dependent values in that list must **not** be cached beyond the API's staleness window:
`targetBackingNow` rises continuously, and `isBehindSchedule` / `isInEnforcedShortfall` /
`shortfallStartedAt` derive from it. They can change with no transaction and therefore no event.
