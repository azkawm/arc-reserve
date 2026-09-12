## ADDED Requirements

### Requirement: The page identifies itself as a design concept

The landing page SHALL carry a persistent, non-dismissible statement that it is a design concept and
not the deployed protocol. The statement MUST remain visible while the user scrolls, MUST NOT be
placed only in the footer, and MUST NOT be removable by user interaction.

This requirement is what makes the page's aspirational content defensible. If it fails, every other
claim on the page becomes an unqualified assertion.

#### Scenario: Label is present on first paint

- **WHEN** the landing page is rendered
- **THEN** a concept statement is present in the accessibility tree and names both what the page is
  (a design concept) and what it is not (the deployed protocol)

#### Scenario: Label survives scrolling

- **WHEN** the user scrolls to the bottom of the page at any supported viewport
- **THEN** the concept statement is still visible without scrolling back up

#### Scenario: Label cannot be dismissed

- **WHEN** the page is inspected for dismiss, close, or hide controls on the concept statement
- **THEN** no such control exists

### Requirement: The page asserts no audit or third-party attestation

The landing page SHALL NOT state or imply that the protocol has been audited, certified, attested, or
reviewed by any named firm or standards body. No audit has been performed, so such a claim is false
under any framing, concept label or not.

#### Scenario: Audit attributions are absent

- **WHEN** the rendered page text is searched for named audit or attestation firms carried by the
  Stitch reference, including "Halborn", "VeriSol", and "Bureau Veritas"
- **THEN** no match is found

#### Scenario: Audit vocabulary is absent

- **WHEN** the rendered page text is searched for "audited", "attested", and "certified"
- **THEN** no match is found

### Requirement: Mockup figures are not presented as live data

Every figure on the landing page is invented. No figure SHALL be presented as current protocol state.
Panels carrying figures SHALL be locally marked as concept data, in addition to the page-level
concept statement, so a reader who lands mid-page still sees the qualification.

#### Scenario: Data-bearing panels are locally marked

- **WHEN** the hero status pill or the telemetry band is rendered
- **THEN** each carries a visible concept marker within the panel itself

#### Scenario: No panel claims to be live

- **WHEN** the rendered page text is searched for "live", "real-time", and "synced" as descriptions of
  the page's own figures
- **THEN** no match is found

#### Scenario: No live read is issued

- **WHEN** the landing page mounts
- **THEN** no request is made to the backend API

### Requirement: Aspirational content is permitted only under the concept framing

Aspirational content SHALL be confined to this labelled page. The page MAY present illustrative asset
series, projected figures, and contractual language that the deployed protocol does not yet
implement, because it is explicitly a concept; that content MUST NOT be reused on any surface that
reads live protocol state.

#### Scenario: Illustrative series are visually consistent with concept framing

- **WHEN** an asset series other than SOLAR01 appears on the page
- **THEN** it appears within a region covered by a concept marker

### Requirement: The page presents the protocol story sections

The landing page SHALL render, in order: header, hero, telemetry band, Dual Participant Engine, Five
Independent Value References, Four-Stage Safety Escalation Ladder, closing call to action, and
footer. Header navigation SHALL resolve to in-page anchors, not to routes.

The five value references and the four-stage ladder describe behaviour the protocol actually
implements, and their content SHALL remain accurate: the five references stay five distinct values,
and the ladder's stages stay in their real order.

#### Scenario: All sections render in order

- **WHEN** the landing page is rendered
- **THEN** each of the eight sections is present, in the order listed

#### Scenario: Navigation scrolls rather than routes

- **WHEN** the user activates a header navigation item
- **THEN** the corresponding section is scrolled into view and the page does not navigate away

#### Scenario: The five references remain distinct

- **WHEN** the Five Independent Value References section is rendered
- **THEN** market spot, TWAP, verified NAV, published floor, and redemption price each appear as a
  separate entry, and none is described as equal to another

### Requirement: The page is usable at phone, tablet and desktop widths

The landing page SHALL render correctly at phone, tablet and desktop viewports. Correct means: no
horizontal overflow of the document, no content clipped beyond the viewport, and navigation that
remains reachable.

#### Scenario: No horizontal overflow at any supported viewport

- **WHEN** the page is loaded in a real browser at phone, tablet, and desktop widths
- **THEN** the document scroll width does not exceed the viewport width at any of them

#### Scenario: Navigation adapts below the desktop breakpoint

- **WHEN** the page is loaded at phone and tablet widths
- **THEN** the desktop navigation is not displayed and an equivalent affordance is reachable

#### Scenario: Wide content scrolls within its own container

- **WHEN** a table or matrix is too wide for the viewport
- **THEN** it scrolls within its own container and does not widen the document

### Requirement: Motion is decorative and interruptible

Animation SHALL never be required to understand the page. All motion SHALL stop when the user has
requested reduced motion, and continuous animation SHALL NOT run while off-screen or while the tab is
hidden.

A CSS media query cannot stop a canvas render loop, so the reduced-motion path for the animated hero
background must be implemented in script and must leave a static background in place.

#### Scenario: Reduced motion halts the animated background

- **WHEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the hero renders a static background and no animation frame loop is started

#### Scenario: Content is readable without animation

- **WHEN** scroll-reveal animation is suppressed
- **THEN** all page content is visible and legible

#### Scenario: Off-screen animation is suspended

- **WHEN** the hero is scrolled out of view or the tab is hidden
- **THEN** the animation frame loop is suspended and resumes when it is visible again

### Requirement: The page loads no third-party assets

The landing page SHALL NOT load images or media from third-party hosts. The Stitch reference sources
its logo from a remote content host; the shipped page MUST use the local wordmark instead.

#### Scenario: Logo is local

- **WHEN** the rendered page markup is inspected
- **THEN** no image source points at a third-party host
