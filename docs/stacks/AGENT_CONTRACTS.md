# Agent brief — Contracts (Solidity / Foundry)

You own `contracts/`. Read `CLAUDE.md`, then `docs/SYSTEM_SPEC.md`, `docs/MARKET_MAKING.md`,
`docs/TESTING.md`, `docs/SECURITY.md`. Complete `docs/AI_COMPREHENSION_CHECK.md` before material
changes.

## You own
- `contracts/src/**`, `contracts/test/**`, `contracts/script/**`, `contracts/foundry.toml`
- `contracts/deployments/*.json` (regenerated, never hand-edited)
- Boundary docs when you change an interface: `CONTRACTS_TO_FRONTEND.md`, `CONTRACTS_TO_BACKEND.md`

## You do not touch
- `frontend/**`, `backend/**`. If they need a new view or event, add it here and announce it in
  the boundary doc; do not edit their code.

## Non-negotiables (from `CLAUDE.md`)
Capped supply; market manager cannot mint; reserve ≠ market inventory; NAV/spot/TWAP/floor/
redemption are distinct; redemption reserve-limited; burn before pay; yield-eligible supply excludes
vesting; price appreciation is not profit; no Hikari minting/bonding curve.

## Commands
```powershell
cd contracts
C:\Users\willi\.foundry\bin\forge.exe build
C:\Users\willi\.foundry\bin\forge.exe test
C:\Users\willi\.foundry\bin\forge.exe coverage --report summary
C:\Users\willi\.foundry\bin\forge.exe fmt --check
anvil   # separate terminal
C:\Users\willi\.foundry\bin\forge.exe script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
```
Baseline: 56 passed / 0 failed / 0 skipped; 5 invariants.

## Interface stability rules
- Do not rename or re-order enum members (`AssetStatus`, `RedemptionMode`, `PositionKind`,
  `SafetyFailure`) — both consumers hardcode the integers.
- Do not change event parameter lists without a `CHANGED` row in `CONTRACTS_TO_BACKEND.md`.
- Do not change function signatures listed in `CONTRACTS_TO_FRONTEND.md` §3 without a `CHANGED` row.
- Keep 6d/18d conventions; never introduce an 8d or 1e18-priced value.
- `deployments/<chainId>.json` key names are an interface; adding keys is fine, renaming is not.

## Scope (D-027)
Hackathon only. Targets: Anvil, **Base Sepolia (84532)**, **Hedera testnet (296)**. `MockUSD` on
all three; no mainnet, no audit claims. Deliverables include `deployments/84532.json` and
`deployments/296.json`, a chain-aware deploy script (`block.chainid`), a verified Uniswap V3
factory address on Base Sepolia (or the mock pool), the mock pool on Hedera unless a V3-compatible
factory is verified, and an `evm_version` both chains support (verify Hedera's EVM version first).
Testnet keys only via untracked `.env`.

## Baseline (2026-08-27)
The compliance layer (D-021) is merged: 75 tests, `src/compliance/`, permissioned `AssetToken`.
`deployments/31337.json` is regenerated. Read D-021 before touching the token.

## First tasks (in order) — business-model alignment, D-022 / D-023 / D-024
1. **Company-token treatment (D-024).** `issuerAllocation` flag on `RevenueDistributor` or token;
   `RedemptionController.redeem` reverts for flagged holders; `investorSupply()` view; switch
   `redemptionPrice`, `minimumRequiredReserve`, `reserveRatioBps` to the investor-supply
   denominator. Tests: flagged holder cannot redeem in any mode; denominators exclude it.
2. **Reserve schedule + enforcement (D-023).** New `ReserveSchedule` state on the vault
   `(startBacking, targetBacking, startTime, maturity, graceSeconds)`; `targetBacking(t)`,
   `currentBacking()`, `isBehindSchedule()`, `shortfallSince`; `depositReserve(amount, periodId)`
   for the issuer; gate `withdrawIssuerProceeds` (and future issuance) on not-in-shortfall past
   grace. Events: `ReserveScheduleSet`, `ReserveContribution`, `ReserveShortfallEntered/Cleared`.
   Invariant: backing never decreases through a redemption.
3. **Dynamic revenue split (D-023) + period tagging (D-022).** `RevenueDistributor` splits become
   admin-settable within bounds with a `behindSchedule` variant (40/45/10/5); `depositRevenue(amount,
   periodId, reportHash)` emits the period; missing period past grace is reported via a view.
4. **Reserve yield hook (D-023).** `accrueReserveYield(amount)` (yield-source role) credits the
   reserve while behind schedule, else `issuerProceeds`. Mock yield source in `DeployLocal`.
5. **Residual return (D-023).** `releaseResidualReserve()` callable at `Closed` after the maturity
   window; pays `reserve − outstandingObligations` to the issuer. Add the maturity window to the
   redemption controller.
6. **Settlement split 65/30/5 (D-023).** Change `PrimaryOffering` bps constants; update tests and
   docs. Escrow/threshold settlement (D-007) remains the next milestone after 1–7.
7. **Floor level-up (D-025).** A small `FloorController` (reads vault, registry NAV, pool
   `tickSpacing`, manager `assetIsToken0`): `floorTick`, `floorPrice()` via `TickPriceMath`,
   `floorLevelCooldown`, permissionless `levelUp()` advancing **one `tickSpacing`** per call in the
   price-up direction iff `price(next) ≤ min(NAV, backing)`; event `FloorLevelUp`. Optional best-
   effort `levelUp` attempts from reserve-crediting paths. `AssetMarketManager.rebalanceToFloor
   (lower, upper)` requiring `upper ≤ floorTick` (price terms) and passing the normal safety gates.
   Invariants: `floorPrice ≤ min(NAV, backing)` always; `floorTick` never moves down in price
   while Active; backing never decreases through a redemption; at most one step per cooldown.
8. **Term-sheet binding (D-026).** `approveAsset(assetId, initialNAV, termsHash)` +
   `reapproveTerms`; registry stores/exposes `termsHashOf(assetId)`; factory checks
   `keccak256(abi.encode(params))` and reverts `TermsMismatch()`. Emit `TermsApproved(assetId,
   termsHash)`. Update `DeployLocal`, `ArcReserveTestBase`, and the `CHANGED` rows (frontend
   `approveAsset`/verifier UI and backend event catalog both change).
9. Then: `DEMO_SEED_LIQUIDITY` option for non-zero positions; synthetic OHLC hook decision
   (`MockUniswapV3Pool` emitting `Swap` vs backend-synthetic); factory role-renounce decision.

Every step: update `docs/SYSTEM_SPEC.md`, `docs/BUSINESS_MODEL.md` "current vs target" table, and
the `CHANGED` rows in `CONTRACTS_TO_FRONTEND.md` / `CONTRACTS_TO_BACKEND.md`.

## Definition of done for any change
`forge test` green, invariants unchanged or extended, `forge fmt --check` clean, coverage not
lower for touched files, boundary doc updated, `docs/SYSTEM_SPEC.md` updated if a formula changed.

## Hand-off artifact
A message to the other agents containing: changed signatures/events, new `deployments/31337.json`,
and the `CHANGED` rows you added.
