## 1. Design system foundation

- [x] 1.1 Transcribe the Stitch colour, type, spacing and radius scales into the app's theme tokens, replacing the dark palette in place
- [x] 1.2 Re-choose the three provenance colours for the light ground so each is distinguishable from the other two and meets AA contrast, and give each a non-colour cue
- [x] 1.3 Add the serif display face with a real fallback stack and wire the sans and serif font tokens
- [x] 1.4 Visual pass over the eight generated UI components under the new palette and the tighter radius scale
- [x] 1.5 Confirm the application-wide reduced-motion rule still applies after the token replacement

## 2. Page shell and concept framing

- [x] 2.1 Build the persistent, non-dismissible concept statement and place it so it survives scrolling at every viewport
- [x] 2.2 Build the concept marker component for data-bearing panels, separate from the provenance badge
- [x] 2.3 Port the monogram wordmark as a local asset so the page loads no third-party image
- [ ] 2.4 Replace the current landing page with the new shell: header, anchor navigation, main region, footer

## 3. Story sections

- [x] 3.1 Hero section: headline, supporting copy, calls to action, and the status pill
- [x] 3.2 Telemetry band: four stat cards, each carrying a concept marker, with no "live" vocabulary in the heading or the cards
- [x] 3.3 Dual Participant Engine section: the investor and issuer pathway cards
- [x] 3.4 Five Independent Value References section, keeping market spot, TWAP, verified NAV, published floor and redemption price as five distinct entries
- [x] 3.5 Four-Stage Safety Escalation Ladder section, preserving the real stage order and triggers
- [ ] 3.6 Closing call to action and footer, with every audit and attestation attribution removed

## 4. Motion

- [x] 4.1 Port the hero WebGL shader into a self-contained component owning context, resize observation, the frame loop and teardown on unmount
- [x] 4.2 Short-circuit the frame loop in script when reduced motion is requested, rendering the static background instead
- [x] 4.3 Suspend the frame loop when the hero is off-screen or the tab is hidden, and cap the device pixel ratio
- [x] 4.4 Fall back to the static background when WebGL is unavailable or the context is lost
- [ ] 4.5 Add section scroll-reveals and hover and focus micro-interactions, all suppressed under reduced motion

## 5. Unit tests

- [ ] 5.1 Negative test: the rendered page contains no named audit firm and no audit vocabulary
- [ ] 5.2 Negative test: the page never describes its own figures as live, real-time or synced
- [ ] 5.3 Positive test: the concept statement is present, names what the page is not, and exposes no dismiss control
- [ ] 5.4 Positive test: every data-bearing panel carries a concept marker
- [ ] 5.5 Positive test: all eight sections render in the specified order and anchor navigation targets resolve
- [ ] 5.6 Edge test: reduced motion starts no frame loop, and a missing WebGL context still renders the static background
- [ ] 5.7 Edge test: mounting the page issues no backend request
- [ ] 5.8 Rewrite the existing landing-page test against the new page, retiring the assertions that referenced the retired data panel

## 6. Responsive tests

- [ ] 6.1 Add the Playwright dev dependency and a config defining phone, tablet and desktop viewport projects
- [ ] 6.2 Assert no horizontal document overflow at all three viewports
- [ ] 6.3 Assert the desktop navigation is replaced by a reachable equivalent below the desktop breakpoint
- [ ] 6.4 Assert wide content scrolls inside its own container rather than widening the document
- [ ] 6.5 Add the npm scripts for the browser suite and document that nothing runs them automatically

## 7. Documentation and verification

- [ ] 7.1 Add a decision record for the palette reversal that explicitly supersedes the relevant part of D-035
- [ ] 7.2 Update the frontend documentation: new stack surface, and the interval during which the read API has no consumer
- [ ] 7.3 Update the testing documentation with the two-runner split, what each runner can and cannot prove, and the new coverage table
- [ ] 7.4 Run the full gate — typecheck, lint, unit tests, browser tests and build — and record the results
