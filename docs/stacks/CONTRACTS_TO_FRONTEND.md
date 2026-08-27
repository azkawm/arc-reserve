# Boundary A — Contracts → Frontend

What the Solidity layer guarantees to the browser app, and what the app may rely on. Signatures
below are verbatim from `contracts/src/` as of 2026-08-27. If a contract changes, the contracts
agent updates this file in the same change and marks the row `CHANGED <date>`.

Scope: direct wallet writes and execution-critical reads over JSON-RPC (wagmi/viem). History,
aggregates, and OHLC are **not** this boundary — see `BACKEND_TO_FRONTEND.md`.

## 1. Address and environment contract

The deploy script writes `contracts/deployments/<chainId>.json` with root key `"arcReserve"`:

| JSON key | Frontend env var | Required for `contractsConfigured` |
| --- | --- | --- |
| `mockUSD` | `NEXT_PUBLIC_MUSD_ADDRESS` | yes |
| `registry` | `NEXT_PUBLIC_REGISTRY_ADDRESS` | yes |
| `token` | `NEXT_PUBLIC_TOKEN_ADDRESS` | yes (currently unused by UI) |
| `vault` | `NEXT_PUBLIC_VAULT_ADDRESS` | yes |
| `offering` | `NEXT_PUBLIC_OFFERING_ADDRESS` | yes |
| `marketManager` | `NEXT_PUBLIC_MARKET_MANAGER_ADDRESS` | yes |
| `revenueDistributor` | `NEXT_PUBLIC_REVENUE_DISTRIBUTOR_ADDRESS` | yes |
| `redemptionController` | `NEXT_PUBLIC_REDEMPTION_CONTROLLER_ADDRESS` | yes |
| `assetId` | `NEXT_PUBLIC_ASSET_ID` | bytes32, used by registry calls |
| `pool` | — (no env var yet) | needed if the UI ever reads `slot0` directly |
| `companyVesting` | — (no env var yet) | needed for the supply panel |
| `identityRegistry` | `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS` (new, 2026-08-27) | KYC status badge, eligibility pre-checks |
| `compliance`, `countryAllowModule`, `transferLockModule` | — | admin screens only |
| `factory` | — | not needed by UI |

Rules:
- Anvil addresses change on every chain restart; `.env.local` must be regenerated. A script that
  copies `deployments/31337.json` into `.env.local` is a legitimate frontend-agent task.
- `NEXT_PUBLIC_RPC_URL` defaults to `http://127.0.0.1:8545`; chain id is `31337`.
- Target chains (D-027): Anvil `31337`, Base Sepolia `84532`, Hedera testnet `296`. Addresses are
  per chain (`deployments/<chainId>.json`); the frontend should hold a `chainId → addresses` map
  rather than a single set of env vars once the testnet deployments exist.
- The UI must verify `chainId` from the wallet is one of the supported chains before any write.

## 2. ABI artifacts

Canonical ABIs live in `contracts/out/<Contract>.sol/<Contract>.json` (`.abi` field) after
`forge build`. The frontend's `parseAbi` strings in `src/lib/contracts.ts` are a hand-maintained
subset and **must match the signatures in §3–§4 exactly**; prefer generating them from `out/`.

## 3. Writes the UI performs today (live)

All amounts in base units. `mUSD` = 6 decimals, `SOLAR01` = 18 decimals.

| UI action | Contract | Signature | Caller requirement | Preconditions the UI should pre-check |
| --- | --- | --- | --- | --- |
| Approve mUSD | MockUSD (ERC-20) | `approve(address spender, uint256 amount) returns (bool)` | any | — |
| Buy | PrimaryOffering | `buy(uint256 stablecoinAmount, uint256 minimumTokensOut) returns (uint256 tokenAmount)` | any; mUSD allowance to offering | `startsAt <= now < endsAt`; `registry.canIssue(assetId)`; `amount >= minimumPurchase`; `stablecoinRaised + amount <= fundraisingCap`; `purchasedByWallet[user] + amount <= walletPurchaseLimit`; `tokenAmount <= availableTokenInventory()` |
| Claim revenue | RevenueDistributor | `claimRevenue() returns (uint256 amount)` | any holder | `claimableRevenue(user) > 0` |
| Redeem (Normal) | RedemptionController | `redeem(uint256 tokenAmount, uint256 minimumStablecoinOut, uint8 mode) returns (uint256 stablecoinAmount)` | any holder | status Active for mode 0; `redeemedThisPeriod + tokenAmount <= periodLimitTokens` (period rolls after `periodDuration`); payout `<= vault.availableRedemptionLiquidity()` |
| Seed reserve | AssetVault | `depositInitialReserve(uint256 amount)` | `msg.sender == vault.issuer()` (address gate, not a role); mUSD allowance to vault | — |
| Deposit revenue | RevenueDistributor | `depositRevenue(uint256 amount)` | `REVENUE_DEPOSITOR_ROLE`; mUSD allowance to distributor | `circulatingSupply() > 0` else `NoYieldEligibleSupply()` |
| Submit asset | AssetRegistry | `submitAsset(string name, string category, string metadataURI, bytes32 metadataHash, uint64 maturityTimestamp) returns (bytes32 assetId)` | `ISSUER_ROLE` | `maturityTimestamp > now` |
| Publish NAV | AssetRegistry | `publishNAV(bytes32 assetId, uint256 newNAV)` | `VERIFIER_ROLE` | status Approved/Active/Suspended; move `<= maxNAVMovementBps` (20%) of previous NAV |
| Suspend / Default / Mature | AssetRegistry | `suspendAsset(bytes32)`, `markDefault(bytes32)`, `markMatured(bytes32)` | `VERIFIER_ROLE` | see status machine in `CLAUDE.md`; `markMatured` needs `now >= maturity` |
| Keeper rebalance | AssetMarketManager | `slide(int24 lo, int24 hi)`, `sweep(int24 lo, int24 hi)`, `rebalanceToNAV(int24 lo, int24 hi)`, `refreshDiscovery(int24 lo, int24 hi)` | `KEEPER_ROLE` | `safetyState(true).failure == None`; target position `configured && liquidity == 0`; each tick within `maxTickShift` (1200) of current; ticks multiples of `tickSpacing` (60); `slide` needs spot > TWAP, `sweep` spot < TWAP |

Redemption `mode` enum: `0 Normal` (Active), `1 Maturity` (Matured), `2 Emergency` (Suspended or
Defaulted).

**Slippage:** `minimumTokensOut` / `minimumStablecoinOut` are currently passed as `0`. The UI should
compute them from the live quote (§4) minus a user-visible tolerance.

## 4. Reads the UI should use instead of fixtures (all view, no backend needed)

| Displayed value | Read | Scale |
| --- | --- | --- |
| Offering price | `PrimaryOffering.tokenPrice()` | 6d mUSD per token |
| Raised / cap / sold / inventory | `stablecoinRaised()`, `fundraisingCap()`, `tokensSold()`, `availableTokenInventory()` | 6d / 6d / 18d / 18d |
| Wallet limit + used | `walletPurchaseLimit()`, `purchasedByWallet(address)` | 6d |
| Offering window | `startsAt()`, `endsAt()` | unix s |
| Buy quote | `tokenAmount = stablecoinAmount * 1e18 / tokenPrice` (round down) | — |
| NAV + age | `AssetRegistry.navOf(bytes32) returns (uint256 nav, uint64 timestamp)`; stale if `now - timestamp > navStaleAfter()` | 6d |
| Asset status | `AssetRegistry.statusOf(bytes32) returns (uint8)` — `0 Pending,1 Approved,2 Active,3 Suspended,4 Defaulted,5 Matured,6 Closed` | enum |
| Full asset record | `AssetRegistry.getAsset(bytes32)` → struct `{id, issuer, name, category, metadataURI, metadataHash, verifiedNAV, navTimestamp, maturityTimestamp, status, contracts_{token,vault,offering,marketManager,revenueDistributor,redemptionController}}` | mixed |
| Protected reserve | `AssetVault.redemptionReserve()` | 6d |
| Market allocation, revenue, proceeds, fees | `marketMakingAllocation()`, `assetRevenue()`, `issuerProceeds()`, `protocolFees()` | 6d |
| Total accounted / solvency | `totalAccounted()`, `totalStablecoinBalance()`, `isSolvent()` | 6d / 6d / bool |
| Reserve ratio | `reserveRatioBps()` (returns `type(uint256).max` when supply is 0), `minimumReserveRatioBps()`, `minimumRequiredReserve()` | bps |
| Supply | `AssetToken.totalSupply()`, `maximumSupply()`; `RevenueDistributor.excludedSupply()`, `circulatingSupply()` | 18d |
| User holdings | `AssetToken.balanceOf(user)`, `MockUSD.balanceOf(user)`, `allowance(user, spender)` | 18d / 6d / — |
| Claimable | `RevenueDistributor.claimableRevenue(address)` — **`0` is a valid answer, not a failure** | 6d |
| Yield eligibility | `yieldEligibleBalanceOf(address)`, `yieldExcluded(address)` | 18d / bool |
| Redemption quote | `RedemptionController.redemptionPrice(uint8 mode)`; payout `= tokenAmount * price / 1e18` | 6d |
| Redemption liquidity | `AssetVault.availableRedemptionLiquidity()` (== `redemptionReserve`) | 6d |
| Period state | `periodStartedAt()`, `periodDuration()`, `redeemedThisPeriod()`, `periodLimitTokens()` | s / s / 18d / 18d |
| Spot / TWAP | `AssetMarketManager.marketPrices() returns (uint256 spotPrice, uint256 twapPrice, int24 meanTick)` | **6d** mUSD per token (the `1e18` factor in `_stablePrice` cancels the asset's 18 decimals) |
| Safety gates | `safetyState(bool includeCooldown) returns (uint8 failure, uint256 spot, uint256 twap, uint256 nav)`; failure enum `0 None,1 Paused,2 AssetNotActive,3 Matured,4 StaleNAV,5 SpotTwapDeviation,6 MarketNAVDeviation,7 ReserveBelowMinimum,8 Cooldown` | — |
| Positions | `positions(uint8 kind) returns (int24 tickLower, int24 tickUpper, uint128 liquidity, bool configured)`; kind `0 ReserveFloor,1 Anchor,2 Discovery,3 Intermediary` | ticks / raw liquidity |
| Token ordering | `assetIsToken0()`, `tickSpacing()` | bool / int24 |
| Policy | `twapWindow()`, `rebalanceCooldown()`, `maxSpotTwapDeviationBps()`, `maxMarketNAVDeviationBps()`, `maxTickShift()`, `lastRebalanceAt()` | — |
| Vesting | `CompanyVestingWallet.start()`, `duration()`, `released(address token)`, `releasable(address token)`, `vestedAmount(address token, uint64 ts)` | 18d |
| **KYC status** | `IdentityRegistry.isVerified(address)`, `contains(address)`, `investorCountry(address)`, `investorClass(address)`, `claimExpiresAt(address)`; `AssetToken.isVerified(address)` | bool / uint16 / uint8 / unix s |
| **Transfer preview** (run before enabling Buy / Send / Redeem) | `AssetToken.transferRestriction(from, to, value) returns (bytes4)` — `0x00000000` allowed; else map selector to §5 | selector |
| Freeze state | `AssetToken.isFrozen(address)`, `getFrozenTokens(address)`; spendable = `balanceOf − getFrozenTokens` | bool / 18d |
| Exempt infrastructure | `AssetToken.isComplianceExempt(address)` | bool |
| Compliance modules | `AssetToken.compliance()` → `ModularCompliance.getModules()`; `TransferLockModule.lockedUntil(compliance, holder)`; `CountryAllowModule.isCountryAllowed(compliance, country)` | — |
| Role checks (to enable/disable operator buttons) | `hasRole(bytes32 role, address)` on the relevant contract; roles are `keccak256("VERIFIER_ROLE")`, `"ISSUER_ROLE"`, `"KEEPER_ROLE"`, `"REVENUE_DEPOSITOR_ROLE"`, `"PAUSER_ROLE"`, `DEFAULT_ADMIN_ROLE = 0x00` | bool |

Position `liquidity` is a raw Uniswap `uint128`; the UI must **not** convert it to mUSD/SOLAR01
amounts (the mock pool has no real curve). Show ticks and recorded liquidity, or wait for backend.

Tick → price: `price_human = 1.0001^tick * 10^(dec0 - dec1)` with the asset as token0 →
`1.0001^tick * 1e12`. One mUSD ≈ tick `-276_324` (asset token0) or `+276_324` (asset token1).

## 5. Revert → user message table

| Error selector | Meaning for the user |
| --- | --- |
| `OfferingNotOpen()` | Offering window closed / not started |
| `AssetNotActive()` | Asset not Active or past maturity |
| `PurchaseTooSmall()` | Below minimum purchase |
| `FundraisingCapExceeded()` / `WalletLimitExceeded()` / `InventoryExceeded()` | Limits |
| `ZeroTokenOutput()` | Amount too small **or** slippage (`tokenAmount < minimumTokensOut`) |
| `NoRevenueToClaim()` | Nothing claimable |
| `NoYieldEligibleSupply()` | Deposit rejected: no eligible circulating supply |
| `InvalidMode()` | Redemption mode does not match asset status |
| `PeriodLimitExceeded()` | Daily redemption limit reached |
| `InsufficientReserveLiquidity()` | Reserve cannot cover payout |
| `InvalidAmount()` | Zero amount, slippage, or emergency price > NAV |
| `NAVMovementTooLarge()` | NAV change > 20% |
| `InvalidStatus()` | Lifecycle transition not allowed from current status |
| `SafetyCheckFailed(uint8 reason)` | Map `reason` via the `SafetyFailure` enum in §4 |
| `PositionHasLiquidity()` | Remove liquidity before moving the range |
| `InvalidRange()` | Ticks not on spacing, out of bounds, or shifted > `maxTickShift` |
| `UnauthorizedIssuer()` | Wrong wallet for reserve deposit |
| `RecipientNotVerified()` | Your wallet (or the recipient) is not KYC-verified / claim expired — complete verification |
| `SenderNotVerified()` | Your KYC claim expired — renew before transferring (redemption still works) |
| `SenderFrozen()` / `RecipientFrozen()` | Address frozen by the transfer agent — contact support |
| `InsufficientUnfrozenBalance()` | Part of the balance is frozen; show spendable amount |
| `ComplianceCheckFailed()` | A compliance rule blocked this: jurisdiction not allowed, or resale hold period active (`TransferLockModule.lockedUntil`) |
| `AccessControlUnauthorizedAccount(address,bytes32)` | Wrong role — show which role |
| `EnforcedPause()` | Contract paused |
| `ERC20InsufficientAllowance` / `ERC20InsufficientBalance` | Approve first / fund wallet |

## 6. Known couplings the frontend must remove

1. **Hardcoded keeper ticks** `[-276540, -275940]` in `engine-controls.tsx`. Must be derived from
   `positions(kind)`, `tickSpacing()`, `assetIsToken0()`, and `marketPrices().meanTick`, and stay
   within `maxTickShift`.
2. **Silent mock fallback** `claimable ? … : "142.80"`. Replace with loading / error / `0` states.
3. **Static "All safety gates clear"** — call `safetyState(false)`.
4. **Buy preview divides by 1.018** (mock spot) — use `tokenPrice()` (1.000000 in the demo).
5. **Redeem preview multiplies by 0.82** — use `redemptionPrice(mode)`.
6. **No receipt wait** — use `useWaitForTransactionReceipt` then invalidate reads.
7. **`submitAsset` ignores form inputs** and sends hardcoded "Solar Indonesia 02".
8. **Decimals hardcoded** (`6`, `18`) — acceptable for the demo, but read `decimals()` once at load.

## 7. What the contracts do NOT provide (do not fake it as live)

- Escrowed/threshold fundraising, partial/failed settlement, refunds.
- Lock-and-earn, issuance-headroom policy controller.
- Sell / router execution (keeper `executeSwap` is not a user sell).
- Fee vs principal split on `collectFees`.
- Any event-derived history (purchases, claims, rebalances) — that is the backend's job.
- Canonical `Swap` events from the mock pool; OHLC cannot be derived from it.

## 8. Change log

| Date | Change | Migration |
| --- | --- | --- |
| 2026-08-27 | Initial boundary snapshot | — |
| 2026-08-27 | **CHANGED** — token is permissioned (D-021). New reads in §4 (KYC status, `transferRestriction`), new errors in §5, new env var `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS`, new JSON keys `identityRegistry`, `compliance`, `countryAllowModule`, `transferLockModule`. `AssetFactory.DeploymentParams` gained `identityRegistry` (last field). | Frontend: show a KYC badge from `isVerified(address)`; disable Buy/Send when `transferRestriction` ≠ 0 and show the mapped reason; only Anvil #0/#1 are verified in the demo. |
