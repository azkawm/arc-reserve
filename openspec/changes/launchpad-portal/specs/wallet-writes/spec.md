## ADDED Requirements

### Requirement: Writes go direct to contracts with a chain guard and preflight

Every wallet write SHALL be submitted directly to a contract on the active chain, never through the backend.
Before submitting, the portal SHALL establish: wallet connected, wallet chain equals the page chain, wallet
verified where the action requires it, and any allowance in place. A write SHALL NOT be offered while a
precondition fails.

#### Scenario: Unverified wallet cannot buy

- **WHEN** an unverified wallet activates the buy action
- **THEN** the portal blocks the write, offers verification where `canSelfRegister` allows, and explains the
  `RecipientNotVerified` rule

### Requirement: The swap sends an explicit gas limit and reports spend and refund

`AssetMarketManager.swapExactInput` SHALL be sent with an explicit gas limit of **1,000,000 on every chain**,
never the wallet's estimate. The confirmation SHALL display `amountSpent` from the `SwapExactInput` event, and
when `amountSpent < amountRequested` SHALL show the refund of the unspent input rather than hiding it.

#### Scenario: A partial fill shows the refund

- **WHEN** a swap confirms with `amountSpent < amountRequested`
- **THEN** the confirmation shows the spent amount and the refund

### Requirement: A swap is quoted before it is offered

The portal SHALL fetch a live quote before enabling the swap action. If the quote is unavailable
(`QUOTE_UNAVAILABLE`), reverts (`details.revertedWith`), or is zero, the direction SHALL be disabled with its
reason, and the input SHALL be bounded near the quoted depth so a wallet cannot reach
`InvalidSwapDirection`.

#### Scenario: Dry direction is disabled, not attempted

- **WHEN** a quote for a direction returns zero or reverts
- **THEN** that direction's swap control is disabled with the reason shown, and no transaction is sent

### Requirement: Every write's approval target is correct

The buy SHALL approve the **offering**; the swap SHALL approve the **market manager** (never the pool or a
router); the redeem SHALL require no approval because tokens burn under the redemption controller's role.

#### Scenario: Swap approval targets the manager

- **WHEN** the swap prepares its approval step
- **THEN** the spender is the market manager address for the active chain

### Requirement: Reverts are decoded and confirmed on receipts

Contract reverts SHALL be decoded with the ABI and shown by their error name, never as "transaction failed".
Success SHALL be confirmed on the receipt's event, not on the RPC returning a hash.

#### Scenario: A revert names its rule

- **WHEN** a write reverts with a known custom error
- **THEN** the UI shows the error name and its plain-language meaning

### Requirement: A confirmed write reconciles with the indexer

After a confirmed receipt the portal SHALL poll `/v1/health` until the `indexers[]` entry for the active chain
reports `blockNumber >= receipt.blockNumber`, then refetch the affected queries. If it does not catch up, the
portal SHALL show an "indexing delayed" state rather than a stale number presented as current.

#### Scenario: Indexer reconciliation gates the refresh

- **WHEN** a write confirms
- **THEN** the affected panels refresh only after the active chain's indexer has reached the receipt's block,
  or the portal reports indexing delayed

### Requirement: Self-registration is gated and idempotent-safe

`DemoRegistrar.selfRegister()` SHALL be offered only when `canSelfRegister(wallet) && isActive()`, and its
result SHALL be confirmed with `IdentityRegistry.isVerified(wallet)`, because a repeat call is a silent no-op.

#### Scenario: Already-verified wallet is not re-offered registration

- **WHEN** the wallet is already verified
- **THEN** the registration action is not offered
