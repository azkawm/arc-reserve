## ADDED Requirements

### Requirement: The offerings screen shows only traceable figures

Every figure on the offerings screen SHALL derive from a served field, a chain read, or a labelled
client-side derivation. Raise progress SHALL come from `metrics.offering.raised` over `.cap`; the issue price
from `.price`; the minimum from `.minimumPurchase`; closes-in from `.endsAt`; solvency from `reserveSchedule`;
and the connected chain's name SHALL replace the reference's "Base Sepolia".

#### Scenario: Raise progress matches metrics

- **WHEN** the offerings screen renders
- **THEN** the raised and cap figures equal `metrics.offering.raised` and `.cap` for the active chain, and the
  progress bar reflects that ratio

#### Scenario: Network label follows the connection

- **WHEN** the active chain is Arc
- **THEN** the network chip reads Arc, never "Base Sepolia"

### Requirement: The floor is always shown with its coverage

Where the offerings screen shows the published floor, it SHALL render `metrics.floor.price` together with
`metrics.floor.covered`, and SHALL describe it as a published reference, not a guarantee and not a price any
wallet is paid.

#### Scenario: Coverage accompanies the floor

- **WHEN** the floor figure is rendered
- **THEN** its coverage (`covered`) is visible in the same panel

### Requirement: No yield, audit, regulatory or guarantee claim is made

The offerings screen SHALL NOT present a forward yield or APR, an audit or third-party attestation, a
regulatory or legal status, or a guaranteed floor or peg. Where the reference carried such a claim, the screen
SHALL show the real figure or an explicit "not implemented" state instead.

#### Scenario: Yield tile is honest

- **WHEN** the reference's "Est. Cash Yield" tile is rendered
- **THEN** it shows trailing realised distributions labelled as historical, or a "not implemented" state, and
  never a projected APR

#### Scenario: No audit attribution

- **WHEN** the rendered text is searched for an audit firm or the words "audited", "attested" or "certified"
- **THEN** no match is found

### Requirement: Pipeline entries exist only when they are real

The pipeline region SHALL render only assets actually returned by `/v1/assets?status=Pending` or
`?status=Approved`. Illustrative pipeline cards with terms, stages or audits SHALL NOT appear.

#### Scenario: No phantom pipeline asset

- **WHEN** no pending or approved asset exists on the active chain
- **THEN** no pipeline card is rendered

### Requirement: Verification is offered only where it can succeed

The "Verify me" affordance SHALL be shown only when `DemoRegistrar.canSelfRegister(wallet) && isActive()`. The
KYC badge SHALL read `IdentityRegistry.isVerified(wallet)` and MUST read false for an unverified wallet.

#### Scenario: Verify button hides on an unsupported chain

- **WHEN** `canSelfRegister(wallet)` is false
- **THEN** the Verify affordance is not offered, so the wallet cannot reach an `UnsupportedChain` revert
