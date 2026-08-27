# ArcReserve Architecture

This document describes component boundaries and system flows. Exact formulas and function behavior
are in `SYSTEM_SPEC.md`; target commercial policy is in `BUSINESS_MODEL.md`.

## 1. System context

```text
                         +----------------------+
                         | Verifier / NAV role  |
                         +----------+-----------+
                                    |
                             NAV and status
                                    |
+--------------+          +---------v----------+          +----------------+
| Asset issuer |--------->|   AssetRegistry    |<---------| Indexer / API  |
+------+-------+ submit   +---------+----------+  events  +--------+-------+
       |                            |                              |
       | deploy approved series     | component registry           | reads
       v                            v                              v
+------+-----------------------------------------------------------+------+
|                          AssetFactory                                   |
| token deployer | vault | offering | revenue | redemption | market       |
+------+-------------+-------------+-------------+------------------------+
       |             |             |             |
       v             v             v             v
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
| AssetToken | | AssetVault | | Offering  | | Revenue / Redemption      |
+------+-----+ +-----+------+ +----+------+ +----+----------------------+
       |             ^             |             |
       |             | stablecoin  |             |
       +-------> AssetMarketManager <-------------+
                         |
                  authenticated callbacks
                         |
                         v
                +--------+---------+
                | V3-compatible    |
                | asset/mUSD pool  |
                +------------------+
```

The backend/indexer box is planned, not implemented.

## 2. Architectural principles

### One isolated system per asset series

Every deployed series has dedicated contracts. Accounting, supply, maturity, revenue, redemption,
and market parameters do not share mutable storage with another series.

### Registry as component directory

The registry binds an asset ID to its issuer, metadata commitment, NAV/status, maturity, and deployed
component addresses. Clients should discover series components from indexed registry/factory data
rather than accepting arbitrary user-supplied contract addresses.

### Category accounting before convenience

The vault does not expose a single treasury balance. Stablecoin is classified by purpose so issuer,
market, redemption, revenue, and protocol rights cannot be conflated.

### Issuance separated from market making

The offering can mint within the cap. The market manager cannot mint. Any future headroom issuance
must use a distinct controller and decision process.

### Independent value references

NAV is verifier-published. Spot/TWAP come from the pool. Protected floor and redemption derive from
reserve backing. The architecture compares them but does not collapse them.

### Observable, recoverable market operations

The MVP range lifecycle is explicit: remove, update, remint. Pause blocks new market risk while
allowing authorized unwind and return of idle funds.

## 3. Deployment topology

### Global/shared contracts

- mUSD stablecoin address, mock in local deployment.
- `AssetRegistry`.
- `AssetFactory`.
- Six approved component deployer contracts.
- Approved pool factory.

### Per-series contracts

- `AssetToken`.
- `AssetVault`.
- `PrimaryOffering`.
- `RevenueDistributor`.
- `RedemptionController`.
- `AssetMarketManager`.
- Asset/stablecoin pool.

### Optional/per-policy contracts

- `CompanyVestingWallet` instances.
- Future offering escrow/settlement controller.
- Future issuance-headroom controller.
- Future lock/reward vault.

The local script deploys a vesting wallet after the factory returns. It is not included in
`AssetFactory.Deployment` or `IAssetRegistry.Contracts` today.

## 4. Component responsibilities

### AssetRegistry

Owns:

- identity and issuer;
- category and metadata URI/hash;
- NAV and timestamp;
- maturity;
- lifecycle state;
- deployed component address tuple; and
- NAV staleness/movement policy.

Does not own token supply, stablecoin, legal documents, or market positions.

### AssetFactory and ComponentDeployers

The factory validates deployment preconditions, obtains/creates the pool, wires roles, registers the
system, activates the record, and hands administration to the protocol admin.

ComponentDeployers isolate creation bytecode so the factory runtime remains below EIP-170. Their
addresses are immutable as a set inside the current factory instance; the factory does not expose an
updater for the set.

### AssetToken

Owns balances, allowances, total supply, maximum supply, permit nonces, pause state, and the immutable
asset binding. It calls the revenue hook around every balance mutation.

### AssetVault

Owns actual mUSD custody and five category ledgers. It is the financial boundary between market,
issuer, protocol, and redemption purposes.

### PrimaryOffering

Owns current sale configuration and purchase counters. It is the normal token minter. The current
version is synchronous direct purchase, not fundraising escrow.

### RevenueDistributor

Owns holder revenue accrual, operator accrual, exclusion state, and transfer-aware reward debt. It
forwards reserve/protocol shares to the vault.

### RedemptionController

Owns redemption modes, period usage, emergency reference, and aggregate redemption totals. It burns
through the token role and pays through the vault role.

### AssetMarketManager

Owns market inventory, pool callback authority, four range records, market policy, and rebalance
timestamp. It reads registry and vault safety state but cannot modify NAV, token cap, or reserve
accounting.

### Frontend

Provides product visualization and selected direct wallet actions. Current read surfaces are mostly
fixtures. It is not an authoritative read model.

### Planned backend/indexer

Will ingest immutable event history, build reorg-safe projections, expose aggregate reads, and derive
OHLC from canonical pool swaps. It will not replace wallet signing or contract authorization.

## 5. Primary purchase flow

Current implementation:

```text
Investor
  | approve mUSD
  v
PrimaryOffering.buy
  | validate window/status/caps/minimums
  | transfer gross mUSD
  v
AssetVault
  | record 70% issuer proceeds
  | record 20% redemption reserve
  | record 10% market allocation
  ^
  | mint purchased tokens
AssetToken -> Investor
```

If any later step reverts, the entire transaction, including mUSD transfer and counters, reverts.

Target settlement adds an escrow and outcome resolver between investor payment and these final
effects. Do not retrofit partial settlement by treating the current `stablecoinRaised` as escrow; its
funds have already been categorized in the vault.

## 6. Revenue flow

```text
Authorized revenue depositor
  | approve and deposit gross mUSD
  v
RevenueDistributor
  |-- 60% retained for eligible holder claims
  |-- 10% retained as operator accrual
  `-- 30% transferred to AssetVault
                     |-- 25% redemption reserve
                     `--  5% protocol fees
```

The token invokes `onTokenTransfer` before each balance change:

```text
checkpoint sender at old balance
checkpoint recipient at old balance
update reward debt to post-transfer balances
adjust excluded supply when crossing exclusion boundary
complete ERC-20 balance mutation
```

This prevents transfer-based capture of earlier distributions.

## 7. Redemption flow

```text
Holder -> RedemptionController.redeem
             | validate mode, period, quote, reserve, min output
             | burn holder SOLAR01
             v
          AssetToken total supply decreases
             |
             v
          AssetVault releases redemptionReserve mUSD
             |
             v
           Holder
```

The backing denominator uses current total supply and therefore falls after a burn. The quote is
computed before the burn for the requested transaction.

## 8. Market funding and position flow

```text
Primary purchase 10% ---> vault.marketMakingAllocation
                                  |
                                  | keeper + safety
                                  v
                         AssetMarketManager mUSD

External asset holder ----------> AssetMarketManager SOLAR01
                                  |
                                  | authenticated mint callback
                                  v
                         V3-compatible position
```

Protected reserve never appears in this flow.

Rebalance:

```text
keeper removes complete position liquidity
-> pool returns principal/collectable amount
-> manager verifies status, maturity, NAV, oracle, reserve, cooldown
-> manager records new ticks
-> keeper separately adds liquidity to the new range
```

The intermediate gap is a known MVP tradeoff.

## 9. Price and oracle flow

```text
AssetRegistry.navOf ------------------------------+
                                                  |
Pool.slot0 -> spot -------------------------------+--> market safety
Pool.observe -> mean tick -> TWAP ----------------+
AssetVault.isSolvent -----------------------------+
Registry.status/maturity/staleness ---------------+
```

The protected floor/redemption path is separate:

```text
Registry NAV + vault redemption reserve + token total supply
                         |
                         v
          RedemptionController.redemptionPrice
```

## 10. Trust boundaries

### Verifier

Trusted to evaluate evidence and publish honest lifecycle/NAV decisions. Movement bounds reduce a
single-update jump but do not make the oracle decentralized or economically secure.

### Protocol admin

Can manage roles, exclusions, pause state, and safety policy. This is a high-trust account. Production
requires multisig, timelock where appropriate, monitoring, and separation of duties.

### Keeper

Can choose ranges, withdraw market allocation, add/remove liquidity, swap, and set emergency
settlement reference when holding the corresponding roles. It cannot mint through the manager or
debit protected reserve.

### Issuer

Can submit its record, seed reserve, buy/deposit as any allowed caller, and withdraw only categorized
issuer proceeds. It cannot directly debit protected reserve.

### Pool

Immutable per market manager. Callbacks are accepted only during a manager-started operation with the
exact active payload. Production safety still depends on using the intended canonical factory and
pool implementation.

### Frontend/backend

Neither may bypass contract roles. The frontend signs only through the user wallet. The first backend
milestone holds no signing keys.

## 11. Failure domains

| Failure | Containment |
| --- | --- |
| Stale NAV | Issuance remains subject to status/time; guarded market actions stop |
| Excess spot/TWAP move | Market funding, adds, swaps, and rebalances stop |
| Excess TWAP/NAV move | Same market safety stop |
| Vault insolvency | Market safety stops; vault category checks continue |
| Asset suspension/default | Normal issuance and market actions stop; emergency mode becomes relevant |
| Manager pause | New risk stops; unwind paths remain |
| Token pause | Transfers/mints stop; authorized redemption burn escape remains |
| Frontend outage | Contracts remain usable directly |
| Backend/indexer lag | Writes remain direct; UI must show stale state |
| Keeper outage between update/remint | Target position remains empty until recovery |
| Mock/canonical pool mismatch | Local tests may pass while production behavior differs; fork tests required |

## 12. Event-driven read architecture

The planned indexer treats contract events as ordered inputs and validates important projections with
periodic direct reads:

```text
RPC logs -> raw immutable log table -> deterministic projectors
         -> asset/accounting/market read models -> HTTP API -> frontend
                                   |
canonical Swap events -> exact price conversion -> OHLC candles
```

Block number plus block hash is part of every checkpoint. See `BACKEND_INDEXER.md` for reorg logic and
schema.

## 13. Upgrade and migration posture

Current components are non-upgradeable. A new implementation requires deploying new contracts or a
new series and migrating through an explicit process. This reduces proxy-admin risk but makes schema
and state migration a future operational concern.

Do not introduce upgradeable proxies casually. A proposal must define:

- upgrade authority and timelock;
- storage-layout discipline;
- emergency rollback;
- holder disclosure;
- indexer versioning; and
- migration tests.

## 14. Production architecture gaps

- Canonical pool factory and fork-tested position integration.
- Production NAV evidence/oracle infrastructure.
- Escrowed fundraising and settlement controller.
- Factory-integrated vesting and governed headroom issuance.
- Backend/indexer/database and monitoring.
- Keeper automation, key isolation, and transaction simulation.
- Fee/principal accounting and realized-surplus policy.
- Legal/custody/compliance integrations.
- Multisig/timelock governance and incident runbooks.

