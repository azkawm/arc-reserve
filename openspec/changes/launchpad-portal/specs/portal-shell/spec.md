## ADDED Requirements

### Requirement: Chain is an explicit dimension defaulting to Hedera

The portal SHALL treat the chain as explicit state, defaulting to **Hedera testnet (`chainId` 296)**, with a
control to switch the whole portal to **Circle Arc testnet (`chainId` 5042002)**. The active chain MUST be
readable by the user and MUST NOT be inferred from the wallet's connected chain.

#### Scenario: Default chain is Hedera

- **WHEN** the portal is opened with no prior selection
- **THEN** the active chain is Hedera 296 and every data panel requests Hedera

#### Scenario: Switch moves the whole portal

- **WHEN** the user switches the chain control to Arc
- **THEN** the route reflects Arc, and every panel re-requests with `chainId=5042002` rather than serving
  Hedera's cached data

### Requirement: Every contract address is keyed by chain

Contract addresses SHALL be resolved from a `chainId → addresses` map built from
`contracts/deployments/<chainId>.json`. No address SHALL be used without its chain, because the same address
can be a different contract on another chain.

#### Scenario: The same address resolves differently per chain

- **WHEN** the portal reads a component address on Hedera and on Arc
- **THEN** it resolves the address from that chain's deployment record and does not reuse the other chain's

### Requirement: No write is offered on the wrong chain

Before any wallet write the portal SHALL verify the wallet's chain equals the page's chain. If it does not, the
action SHALL be disabled and a chain-switch affordance offered, rather than submitting a transaction that
would fail or act on the wrong deployment.

#### Scenario: Wrong-chain wallet is blocked

- **WHEN** the page is on Arc and the wallet is connected to Hedera
- **THEN** the write controls are disabled and a switch-to-Arc affordance is offered

### Requirement: The portal is routable

The app SHALL expose the existing landing page at `/`, the offerings screen at `/offerings`, and the asset
trading desk at `/assets/:slug`. The landing page's in-page anchor navigation SHALL continue to work.

#### Scenario: Detail route resolves a slug to an asset

- **WHEN** the user opens `/assets/<slug>` for an indexed asset
- **THEN** the slug is resolved to the asset's `bytes32` assetId and the trading desk renders for it
