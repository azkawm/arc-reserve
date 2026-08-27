# Hedera Asset Tokenization Studio (ATS) — integration study

Studied 2026-08-27 from `github.com/hashgraph/asset-tokenization-studio` (`main`). Apache-2.0.
This is an assessment, not a decision. Decision goes in `docs/DECISIONS.md` once the owner picks
an option in §6.

## 1. What ATS is

An open-source security-token stack built by Hedera, in a monorepo:

| Package | Path | What |
| --- | --- | --- |
| Contracts | `packages/ats/contracts` | Solidity 0.8.28 (cancun) + 0.8.17, Hardhat. ERC-1400 family (1410/1594/1643/1644), partial ERC-3643 (T-REX), ERC-20/Permit/Votes. **EIP-2535 diamond**: every token is a `ResolverProxy` that resolves function selectors through a `BusinessLogicResolver` (BLR) to ~100 facets. `factory/Factory.sol` + `factory/ERC3643/TREXFactory.sol` deploy tokens. |
| SDK | `packages/ats/sdk` | TypeScript, DDD/CQRS. **Requires Hedera mirror node + JSON-RPC relay**; cannot run against a plain EVM RPC. Custodian adapters: Dfns, Fireblocks, AWS KMS. |
| Web | `apps/ats/web` | React 18 + Chakra, WalletConnect. Hedera-specific. |
| Mass payout | `packages/mass-payout/*`, `apps/mass-payout/*` | `LifeCycleCashFlow.sol`: snapshot-based batch distribution / bond cash-out in an **ERC-20 payment token**; NestJS + Postgres backend, React admin. |

Networks in `hardhat.config.ts`: `hardhat` (1337), `local`, `hedera-local/previewnet/testnet/mainnet/hashsphere`.
**The contracts are generic EVM** — nothing in the ATS token facets references the HTS precompile.
Mass-payout has an `AssociateTokenFailed` path (HTS token association) that must be verified as
no-op on non-Hedera chains before use.

### Security types (`IFactory.SecurityType`)
`BondVariableRate`, `Equity`, `BondFixedRate`, `BondKpiLinkedRate`, `Loan`, `DepositToken`.

`deployBond(BondData, FactoryRegulationData)` where:
```solidity
struct SecurityData {
  IBusinessLogicResolver resolver; uint256 maxSupply; ResolverProxyConfiguration resolverProxyConfiguration;
  ICore.ERC20MetadataInfo erc20MetadataInfo; IResolverProxy.Rbac[] rbacs;
  address[] externalPauses; address[] externalControlLists; address[] externalKycLists;
  address compliance; address identityRegistry;               // ERC-3643 hooks
  bool arePartitionsProtected; bool isMultiPartition; bool isControllable; bool isWhiteList;
  bool clearingActive; bool internalKycActivated; bool erc20VotesActivated;
}
struct BondDetailsData { bytes3 currency; uint256 nominalValue; uint8 nominalValueDecimals; uint256 startingDate; uint256 maturityDate; }
struct BondData { SecurityData security; BondDetailsData bondDetails; address[] proceedRecipients; bytes[] proceedRecipientsData; }
```
`FactoryRegulationData` encodes Reg S / Reg D type+subtype, accredited-investor rules, max
non-accredited investors, manual verification, international investors, resale hold period.

### Compliance and control facets (the part ArcReserve lacks)

| Facet | Mechanism |
| --- | --- |
| `kyc` | Internal KYC: `grantKyc(account, vcId, validFrom, validTo, issuer)` / `revokeKyc`. Status `NOT_GRANTED/GRANTED` with validity window. `KYC_ROLE`, `KYC_MANAGER_ROLE`, `INTERNAL_KYC_MANAGER_ROLE`. |
| `ssiManagement` | Issuer list (`addIssuer/removeIssuer`) + `setRevocationRegistryAddress` — verifiable-credential issuers whose VCs are accepted for KYC. |
| `externalKycListManagement` | Plug in external KYC registries (`isExternallyGranted(account, status)`). Same pattern for `externalControlListManagement` and `externalPauseManagement`. |
| `controlList` | Whitelist **or** blacklist mode (`initializeControlList(isWhiteList)`), `addToControlList/removeFromControlList`. |
| `identity` / `compliance` | ERC-3643 `identityRegistry()` / `compliance()` with `canTransfer`; compiled from `@tokenysolutions/t-rex` packages. |
| `freeze` | `freezePartialTokens`, `setAddressFrozen` (ERC-3643 semantics). |
| `lock` / `transferAndLock` | Time-locked balances with `release`, `forceReleaseByPartition`. |
| `hold` | Escrow primitive: `Hold{amount, expirationTimestamp, escrow, to, data}`; execute / release / reclaim; operator / controller / protected variants. |
| `clearing` | Two-step transfers/redeems/holds approved by `CLEARING_VALIDATOR_ROLE`; can be toggled per token. |
| `controller` | `isControllable` → forced transfer / forced redeem (`CONTROLLER_ROLE`). |
| `protectedPartition` | Partition-level transfer restriction with EIP-712 signed approvals. |
| `recovery` | Lost-wallet recovery (ERC-3643 `recoveryAddress`). |
| `documentation` | ERC-1643 document registry (`DOCUMENTER_ROLE`). |
| `cap` / `capByPartition` | Max supply, per-partition caps. |
| `pause` + external pauses | |

### Corporate-action facets

| Facet | Mechanism |
| --- | --- |
| `snapshot` / `balanceTracker*` | Record-date snapshots; balances at snapshot, adjusted balances (`AdjustBalances` for splits). |
| `coupon` (+ `fixedRate`, `interestRate`, `kpiLinkedRate`) | `setCoupon(Coupon{recordDate, executionDate, startDate, endDate, fixingDate, rate, rateDecimals, rateStatus})`. Entitlement = balance-at-snapshot × nominal × rate, exposed as `getCouponAmountFor` **numerator/denominator**. **No payment happens in the token** — payment is the mass-payout contract's job. |
| `dividend` | Same shape for equities. |
| `amortization` | `setAmortization({recordDate, executionDate, tokensToRedeem})`: scheduled pro-rata **principal repayment by redeeming tokens**, using holds for DvP. |
| `maturity` | `fullRedeemAtMaturity(holder)` — `MATURITY_REDEEMER_ROLE` burns **all** of the holder's partitions. Burn only; the cash leg is mass-payout `executeBondCashOut`. |
| `principal` | `getPrincipalFor(account)` numerator/denominator of outstanding principal. |
| `proceedRecipient` | Registry of addresses entitled to proceeds with opaque `bytes` data — a hook for splitting payments, not an accounting engine. |
| `scheduledTasks*` | On-chain scheduler that fires snapshots / balance adjustments / coupons on their dates when poked. |
| `kpi` / `kpiLinkedRate` | Sustainability-linked rate: rate steps by KPI outcome — relevant for a solar asset. |

### Roles
`bytes32` = `keccak256("security.token.standard.role.<name>")`. Notable: `DEFAULT_ADMIN_ROLE`,
`ISSUER_ROLE` (mint), `CONTROLLER_ROLE`, `CAP_ROLE`, `SNAPSHOT_ROLE`, `CORPORATE_ACTION_ROLE`,
`BOND_MANAGER_ROLE`, `MATURITY_REDEEMER_ROLE`, `KYC_ROLE`, `KYC_MANAGER_ROLE`, `SSI_MANAGER_ROLE`,
`CONTROL_LIST_ROLE`, `FREEZE_MANAGER_ROLE`, `LOCKER_ROLE`, `CLEARING_ROLE`,
`CLEARING_VALIDATOR_ROLE`, `PAUSER_ROLE`, `DOCUMENTER_ROLE`, `PROTECTED_PARTITIONS_ROLE`, `AGENT_ROLE`.

## 2. ArcReserve ↔ ATS concept map

| ArcReserve (today / agreed model) | ATS equivalent | Fit |
| --- | --- | --- |
| `AssetToken` (capped ERC-20, mint by offering, burn by redemption) | Bond diamond (`BondFixedRate` or `BondVariableRate`) with `maxSupply`, `ISSUER_ROLE` mint, controller/operator redeem | Direct replacement |
| Secured revenue-participation note | **Bond** with `nominalValue = 1.000000 mUSD`, `currency = "USD"` | Exact |
| 60% revenue share to holders | `coupon` (variable rate set per period from actual revenue) + snapshot + `LifeCycleCashFlow.executeDistribution` | Model change: transfer-hook accumulator → **record-date snapshots**. Institutional norm. |
| Company vesting, yield-excluded | `transferAndLock` / `lock` **or** a separate partition; exclude from coupon by distributing to the investor partition only | Partial — ATS coupons count locked balances; exclusion needs partition or address-list distribution |
| Sinking-fund reserve → 1.0 at maturity, tokens stay outstanding | No equivalent. ATS `amortization` is the *other* sinking-fund style (redeem tokens pro-rata as principal is repaid) | **Keep ArcReserve vault**; optionally offer ATS amortization as an alternative bond type later |
| `AssetVault` five buckets, reserve ratio, solvency | None | Keep |
| `RedemptionController` `min(NAV, reserve/supply)`, period limits | `maturity.fullRedeemAtMaturity` (burn) + mass-payout cash-out; no early, price-capped redemption | Keep ours; at maturity either keep ours or map to ATS maturity + cash-out |
| `AssetRegistry` NAV / verifier / lifecycle | None (ATS has `documentation` + regulation metadata, no NAV oracle) | Keep |
| `PrimaryOffering` escrow (target) | None. `hold` + `clearing` give a DvP primitive but no cap/threshold/refund logic | Keep ours; mint through ATS `ISSUER_ROLE` at settlement |
| `AssetMarketManager` (ARC engine) | None | Keep. **Caveat:** an ATS token with KYC/control list must whitelist the pool and the manager, and secondary AMM trading of a permissioned security is itself a compliance question |
| KYC / eligibility / transfer restriction (flow §3) | `kyc`, `ssiManagement`, `controlList`, `external*Lists`, ERC-3643 `identityRegistry`+`compliance`, `freeze`, regulation data | ATS wins outright — this is the gap ArcReserve cannot close cheaply |
| Maker–checker on transfers | `clearing` (validator approval) | Available |
| Document hashing | `documentation` (ERC-1643) | Available |
| Investor classes, Reg S/D, resale hold period | `FactoryRegulationData` | Available (US-centric enums; Indonesia would map onto "international investors") |
| Backend indexer | ATS SDK reads via **Hedera mirror node**; on Anvil/EVM you index ATS events with our planned viem indexer | Our backend plan still applies |
| Frontend | ATS web app is Hedera/Chakra/WalletConnect | Not reusable; our Next/wagmi app calls ATS ABIs directly |

## 3. What integration would break in the current contracts

1. `RevenueDistributor.onTokenTransfer` hook — ATS tokens do not call external hooks. The
   accumulator model must be replaced by snapshot-based coupons or re-implemented on ATS `Transfer`
   events offchain (not acceptable for payouts). → adopt coupons + mass-payout.
2. `RedemptionController.burnForRedemption(from)` — needs ATS `CONTROLLER_ROLE`
   (`isControllable=true`) or an operator/hold-based redeem. Works, but "controller" is a strong
   power; scope it to the redemption contract only.
3. `PrimaryOffering.mint` → ATS `ISSUER_ROLE` `issueByPartition`/`mint`; must also pass KYC/control
   list for the buyer (ATS enforces on mint).
4. `AssetVault.minimumRequiredReserve` reads `totalSupply()` — ATS ERC-20 facet provides it; fine.
5. Market manager / pool: must be whitelisted; `transferAndLock`/freeze interplay with LP tokens is
   untested territory.
6. Toolchain: ATS is Hardhat/0.8.28; ArcReserve is Foundry/0.8.24. Do **not** vendor ATS sources
   into `contracts/src`. Deploy ATS with its own scripts (`npm run deploy:hardhat -- --network local`
   against Anvil) and consume addresses + ABIs. Foundry tests would use `vm.etch`/fork of that
   deployment or an interface-only mock.
7. Deployment weight: BLR + ~100 facets + factory. Their checkpointed deploy handles it, but Anvil
   restart = full redeploy (minutes). `deployments/31337.json` gains `ats.blr`, `ats.factory`,
   `ats.bond`.
8. Upgrade trust surface: BLR owner can swap any facet for every token. Institution-grade means BLR
   ownership = multisig + timelock, documented in `SECURITY.md`.

## 4. Integration options

### Option A — Adopt ATS compliance layer only (ERC-3643 gate on `AssetToken`)
Keep all ArcReserve contracts. Add an `identityRegistry`/`compliance` check (T-REX interfaces, which
ATS already vendors) inside `AssetToken._update`, plus a control-list and freeze. Deploy only
`IdentityRegistry`, `ClaimTopicsRegistry`, `TrustedIssuersRegistry`, `ModularCompliance`.
- Gets: permissioned transfers, KYC claims from trusted issuers, freeze, forced transfer.
- Keeps: accumulator revenue, reserve/redemption engine, market manager, current tests.
- Cost: small–medium (contracts agent, ~1–2 weeks).
- Misses: coupons/amortization/documentation/regulation metadata/clearing, and the "built on ATS" story.

### Option B — Replace `AssetToken` with an ATS Bond; keep the ArcReserve engine around it
ATS bond diamond is the security; ArcReserve registry/vault/offering/redemption/market are the
"issuance and reserve engine" holding roles on it. Revenue moves to coupons + mass-payout with
the vault as payment source.
- Gets: everything in §1; a genuinely institution-grade token; KPI-linked rate for solar.
- Cost: large. Rewrites `RevenueDistributor` (→ snapshot/coupon adapter), touches offering,
  redemption, market manager, deploy script, all tests, frontend ABIs, indexer event catalog.
- Risk: two toolchains, heavy local deploy, ATS upgrade surface, permissioned-AMM compliance question.

### Option C — Move to Hedera and ATS end-to-end
Use ATS SDK + web app; ArcReserve becomes a Hedera extension (reserve vault, NAV, redemption,
market). Drop the Next/wagmi frontend and viem indexer.
- Gets: full ATS stack, mirror-node history for free, custodian integrations.
- Cost: largest; abandons current frontend and backend plan; Hedera-only.

### Status (2026-08-27): Option A implemented
`contracts/src/compliance/` ships `IdentityRegistry`, `ModularCompliance`, two modules, and
`adapters/AtsExternalKycList.sol`. The adapter implements ATS's `IExternalKycList.getKycStatus`
(`contracts/facets/layer_1/externalKycList/IExternalKycList.sol`), so an ATS bond/equity can list
it in `SecurityData.externalKycLists` and share ArcReserve's KYC decisions. This is the bridge
that makes a later move to Option B a token swap rather than a compliance rewrite.

**SDK compatibility, stated plainly:**
- Hedera network + `@hashgraph/sdk` / JSON-RPC relay: yes — the contracts are plain EVM Solidity
  and can be deployed and called through `ContractExecuteTransaction` or any ethers/viem client.
- ATS TypeScript SDK (`Security`, `Kyc`, `Bond` services): **no** — it drives ATS diamond facets
  (`grantKyc` on the token, partitions, BLR) and needs a mirror node. `AssetToken` is not an ATS
  diamond. Only the read-side registry interface (`isVerified`, `investorCountry`, `identity`) and
  the external-KYC-list adapter are shared.

### Recommendation
**A now, B as the roadmap.** A closes the biggest institutional gap (transfer permissioning) in
days without destabilising the tested reserve/redemption engine, and it uses the *same* ERC-3643
interfaces ATS uses — so a later move to B replaces the token, not the compliance wiring. Choose B
only if the owner commits to snapshot-based revenue and accepts the Hardhat sub-project. C only if
Hedera is a business requirement.

## 5. If Option B is chosen — division of work per stack

| Stack | Work |
| --- | --- |
| Contracts | `contracts/ats/` Hardhat sub-project pinned to an ATS release; deploy script for BLR/factory/bond on Anvil; `IAtsBond` interface in `src/interfaces`; adapters: offering → `mint`, redemption → controller redeem, revenue → `setCoupon` + snapshot + `LifeCycleCashFlow`; role wiring; tests via fork of the ATS deployment |
| Backend | Add ATS events to `CONTRACTS_TO_BACKEND.md` (`Transfer`/`TransferByPartition`, `KycGranted/Revoked`, `CouponSet`, `SnapshotTriggered`, `DistributionExecuted`, `AmortizationSet`, `TokensFrozen`, control-list events); holders view must be partition-aware |
| Frontend | KYC status + eligibility badges, blocked-transfer reasons (`canTransfer` codes, EIP-1066), coupon schedule + claim-by-distribution UI, documents tab from ERC-1643, admin screens for KYC/control list |

## 6. Decisions for the owner

1. Option A / B / C.
2. If B: revenue as **snapshot coupons** (ATS) — accept that yield is by record date, not continuous?
3. If B: which bond type — `BondVariableRate` (rate set per period from revenue) or
   `BondKpiLinkedRate` (rate steps on solar KPIs)?
4. Chain: stay EVM/Anvil (ATS contracts only) or Hedera (SDK + mirror node)?
5. Company tokens: separate partition (recommended) or address-list exclusion at distribution?
6. Is AMM trading of a KYC'd security in scope, or does secondary trading become clearing-approved
   transfers only?

## 7. Sources
- Repo root README, `packages/ats/contracts/README.md`, `packages/ats/sdk/README.md`,
  `packages/mass-payout/contracts/README.md`
- Interfaces read: `IFactory`, `ICoupon(+Types)`, `IAmortization`, `IMaturity` (+ `Maturity.sol`),
  `IPrincipal`, `IProceedRecipients`, `IFixedRate`, `IInterestRate`, `IKpiLinkedRate`, `IKyc`,
  `ISsiManagement`, `IControlList`, `IExternalKycListManagement`, `IHoldFacet(+Types)`,
  `IClearing(+Types)`, `IFreeze`, `ILock`, `IIdentity`, `IComplianceFacet`, `regulation.sol`,
  `ILifeCycleCashFlow`, `hardhat.config.ts`
