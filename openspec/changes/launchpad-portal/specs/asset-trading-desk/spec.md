## ADDED Requirements

### Requirement: The four prices remain four distinct values

The trading desk SHALL render spot, verified NAV, the published floor reference, and the redemption price as
four separate values. None SHALL be described as equal to another, and the floor SHALL NOT be described as
the price a redemption is paid at.

#### Scenario: Floor and redemption price are visibly different

- **WHEN** the desk renders both the floor and the redemption price
- **THEN** they appear as separate figures, and the redemption value is `metrics.redemptionPrice.normal`, not
  `metrics.floor.price`

#### Scenario: Spot is gated on market status

- **WHEN** `metrics.marketStatus` is not `ready`
- **THEN** spot is shown as unavailable rather than as a stale or zero price

### Requirement: Redemption pays the quote, never the floor

The redeem panel SHALL compute its you-receive from the redemption quote (`A.redemptionQuote` /
`metrics.redemptionPrice.normal`, i.e. `min(NAV, backing)`), SHALL show the NAV's age alongside it, and SHALL
show the per-period limit in **tokens**, not mUSD.

#### Scenario: Redeem does not use the floor price

- **WHEN** the redeem preview is rendered
- **THEN** its price equals the redemption quote, and the floor price does not appear in the preview

#### Scenario: NAV age is shown with the quote

- **WHEN** the redeem quote is displayed
- **THEN** the age of the NAV that binds it is visible

### Requirement: The chart distinguishes "no trades" from an empty series

When `/candles` returns `503 MOCK_DISABLED`, the chart SHALL render a "no trades yet" state, not an empty
chart drawn as a flat line at zero. A NAV line SHALL come from `/nav-history` as a step series, and the floor
series SHALL be labelled as recent when it comes from a bounded activity window.

#### Scenario: No trades is an explicit state

- **WHEN** candles return `MOCK_DISABLED`
- **THEN** the chart shows "no trades yet" and draws no zero-valued series

### Requirement: Position and claim reflect on-chain values

The position panel SHALL read balance and claimable from the account route (display) and chain (before a
write), SHALL compute market value client-side and label it `derived`, and SHALL render spendable balance as
balance minus frozen tokens.

#### Scenario: Claimable zero is valid

- **WHEN** `claimable` is zero
- **THEN** the panel shows zero, not a fallback figure and not an error

### Requirement: Unimplemented claims are absent or relabelled

The desk SHALL NOT present SCADA/telemetry, credit ratings, named verification firms, forward APR, or
"auto-staking". Where the reference carried such an element, the screen SHALL show a real equivalent or remove
it.

#### Scenario: No named verification firm

- **WHEN** the rendered text is searched for the reference's named firms (for example JLL, CertiK, Chainlink)
- **THEN** no match is found
