## ADDED Requirements

### Requirement: Every request carries the requested chain and is checked against the response

Every backend request SHALL send `?chainId=` for the active chain, and the matching query key SHALL contain
that chain. The caller SHALL read `meta.chainId` back and treat a mismatch as an error, never rendering the
other chain's data.

#### Scenario: Omitted chain never means "the default"

- **WHEN** a panel is rendered on Arc
- **THEN** its request includes `chainId=5042002` and the query key includes the chain

#### Scenario: A response for the wrong chain is rejected

- **WHEN** a response returns `meta.chainId` different from the request
- **THEN** the panel renders an error state and does not display the response

### Requirement: A failed or incomplete read is never replaced by a fixture

A failed request SHALL render an error state, and a read the backend marks incomplete or stale SHALL render a
stale or incomplete state. No example figure from the Stitch reference SHALL survive as a fallback.

#### Scenario: Failed read is an error, not a number

- **WHEN** a request fails
- **THEN** the panel shows an error with a retry and shows no plausible number

#### Scenario: Not indexed yet is distinct from an error

- **WHEN** a response has `asOf: null`
- **THEN** the panel reads "not indexed yet" rather than an error or a zero

### Requirement: Nullable values render as unknown, not zero

Fields that are nullable by design — `change24h`, `spot`, `floor`, `reserveSchedule`, `redemptionQuote` — SHALL
render a dash or an explicit unknown when null. They MUST NOT render `0`.

#### Scenario: Null change renders a dash

- **WHEN** `change24h` is null
- **THEN** the value renders as a dash, and no `0` or `0.0%` is shown

### Requirement: Provenance is rendered per panel and per field

Each panel SHALL render its provenance, taking a field's own `{ value, provenance }` when it has one and the
envelope's provenance otherwise. The three provenance states SHALL remain visually distinguishable with a
non-colour cue.

#### Scenario: A field-level provenance overrides the envelope's

- **WHEN** a response envelope is `onchain` but `spot` carries its own provenance
- **THEN** the spot panel badges from the field, not the envelope

### Requirement: TWAP is absent

There is no time-weighted price (D-036). The client SHALL NOT type, render, or legend a `twap` value, and no
caption SHALL describe a price as a "weighted average".

#### Scenario: No TWAP surface

- **WHEN** the source is searched for TWAP rendering or the `twap` field
- **THEN** only a comment explaining its removal is found

### Requirement: Error codes map to distinct UI states

The client SHALL distinguish `CHAIN_UNAVAILABLE` ("this deployment cannot serve that chain"), `BAD_REQUEST`
(chain picker error naming the indexed chains), `MOCK_DISABLED` on candles ("no trades yet"), and
`QUOTE_UNAVAILABLE` (swap quote unavailable). A rate-limited request (`429`) SHALL be surfaced as such.

#### Scenario: Chain unavailable is not a dead asset

- **WHEN** the API returns `503 CHAIN_UNAVAILABLE` for a chain
- **THEN** the panel states the deployment cannot serve that chain, and does not render the asset as dead
