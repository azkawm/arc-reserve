## Context

`frontend/` is a React 19 + Vite 8 SPA with Tailwind v4, shadcn/ui, wagmi and a working `/v1` client
(D-035). Its single page exists to prove that stack works, not to tell the product's story.

The Stitch reference in `stitch-ui/` supplies both a design system and a page structure. Two of its
sections describe real implemented behaviour; the rest is aspirational. Its code is a single
Tailwind-play-CDN HTML file per variant, with the design system expressed as an inline
`tailwind.config` — colours, a named type scale, a spacing scale, and a radius scale.

Constraints this design works under:

- The repository's product rules forbid presenting target behaviour as implemented without labelling.
  The page is therefore a labelled concept, and the label is load-bearing, not decorative.
- The current page is the only consumer of the `/v1` client. Replacing it leaves that layer with no
  consumer until the follow-up change; this is accepted, and recorded so it is not mistaken for
  breakage.
- There is no CI. Tests added here run locally only, which caps what "enforced" can mean.

## Goals / Non-Goals

**Goals:**

- Port the Stitch visual system into the app's existing token contract, so the whole app moves at once
  rather than the landing page becoming a stylistic island.
- Ship the story sections with motion that reads as considered rather than decorative.
- Make the concept framing structurally hard to miss, and make the prohibited-claims rule mechanically
  checkable rather than a matter of reviewer attention.
- Establish real cross-viewport testing, since the current runner cannot do it at all.

**Non-Goals:**

- The SOLAR01 deep-dive, the Yield & Floor Simulator, the offerings table, and any `/v1` wiring.
- Routing and the four navigation destinations. Navigation is in-page anchors; the standing
  instruction against adding a router still holds while there are no panels to route to.
- Restoring the wallet-write panels retired in D-035. Unrelated backlog.
- Pixel-identical reproduction of the Stitch render. The reference is a design source, not an
  acceptance target; where it conflicts with the product rules, the rules win.

## Decisions

### Hand-port section by section rather than adopting the reference HTML

The reference is ~1,300 lines of one-file HTML with CDN Tailwind and an inline config. Adopting it
wholesale would mean a second, divergent styling system alongside the app's Tailwind v4 tokens, and
would carry the reference's copy into the codebase by default rather than by decision.

Each section is instead rebuilt as a React component reading the app's tokens, with copy authored
against the spec's claim rules. *Alternative considered:* paste the HTML into one component and
refactor down. Faster to a first render, but it makes the prohibited claims the default state of the
code, which is exactly the failure this change exists to prevent.

### Translate the reference's `tailwind.config` into the existing token contract

Tailwind v4 has no config file here; the theme lives in CSS. The reference's colour, type, spacing and
radius scales are transcribed into the app's existing `@theme` block, replacing the dark values in
place. The generated UI components consume those tokens already, so they follow automatically.

The radius scale tightens considerably (the reference's default radius is roughly a fifth of the
current one). This visibly re-shapes every generated component, so a deliberate visual pass over them
is part of the work rather than an afterthought.

### A dedicated concept marker, not the provenance badge

The existing provenance badge answers "where did this number come from" for data that travelled
through the data layer. These figures never did. Reusing the `mock` badge would overload a component
whose contract is about data lineage, and would imply a fixture pipeline that is not there.

A separate concept marker is introduced for the landing page, sharing the visual language but naming
a different thing. The provenance badge is left untouched for the follow-up change, when real reads
return. *Alternative considered:* reuse the `mock` badge. Rejected for the contract-overloading reason
above, and because the two would then have to be told apart on the same page later.

### The prohibited-claims rule is a test, not a review convention

The claims that may not appear — named audit firms, audit vocabulary, "live" as a description of the
page's own figures — are asserted by a unit test that renders the page and searches its text. A
reviewer's attention does not survive a year of edits; a failing test does.

This is the change's primary negative test, and it is the reason the spec states the forbidden strings
explicitly rather than gesturing at "no false claims".

### WebGL background as a self-contained component with a scripted reduced-motion path

The hero background is a fragment shader over a full-viewport canvas. It is wrapped in one component
owning the whole lifecycle: context acquisition, resize observation, the animation loop, and teardown
on unmount.

Two behaviours are not optional. A CSS media query cannot stop a canvas loop, so reduced-motion is
checked in script and short-circuits to a static background before any loop starts. And a full-screen
fragment shader running unconditionally is a battery cost on phones, so the loop suspends when the
hero leaves the viewport or the tab is hidden.

Failure is expected to be graceful: no WebGL context, or a lost context, falls back to the same static
background rather than an empty area. *Alternative considered:* a CSS/SVG approximation with no
canvas. Cheaper and trivially covered by the existing reduced-motion rule, but visibly flatter than
the reference, which is the one thing the hero is for.

### Map the reference's icons onto the installed icon set

The reference uses Material Symbols, an icon font. `lucide-react` is already a dependency and is
tree-shaken per icon. Mapping the handful of icons used avoids a webfont download for glyphs, at the
cost of small shape differences from the reference.

### Split the test responsibilities by what each runner can actually prove

Vitest with jsdom keeps unit behaviour: the claim rules, section presence and order, the concept
marker, reduced-motion branching, and formatting edge cases. It cannot prove layout — jsdom has no
cascade and no layout engine — so it is not asked to.

Playwright covers what only a real browser can: no horizontal overflow, navigation adaptation, and
in-container scrolling of wide content, at phone, tablet and desktop widths. Without this split the
responsive requirement would be asserted by tests that cannot fail for the reason they claim to test.

## Risks / Trade-offs

- **The concept label is read as boilerplate and the aspirational claims land as real claims.** →
  The label is persistent and non-dismissible, repeated locally on every data-bearing panel, and
  named in the spec with its own scenarios. This is mitigation, not elimination: a reader who ignores
  a persistent banner is not reachable by design. Accepted deliberately as the cost of the concept
  route.
- **Between this change and the follow-up, the app demonstrates the backend nowhere.** → Recorded in
  the docs updated by this change, so it reads as a known interval rather than a regression. The
  backend's own tests continue to cover it.
- **A full-screen shader degrades low-end phones.** → Loop suspended off-screen and on hidden tabs,
  device pixel ratio capped, and a static fallback on any context failure. Residual risk on very old
  devices is accepted for a demo surface.
- **Playwright's browser download is heavy and nothing runs it automatically.** → Kept as a local
  command and documented alongside the existing checks. With no CI, these tests are enforced by
  habit; that limit is stated rather than implied.
- **The palette reversal contradicts a recorded decision.** → A new decision record supersedes the
  relevant part of D-035 explicitly, rather than leaving two decisions in silent conflict.
- **Retiring the current page deletes the tests that prove the data layer works.** → Those tests are
  rewritten against the new page; the `/v1` client's own unit tests are untouched and still pass.

## Migration Plan

No data migration. The change is additive to the repository and destructive only to the current
landing page, which is preserved in version control.

Rollback is reverting the change: the retired page, its tests, and the dark palette all return
together, because they are replaced in the same commit rather than piecemeal.

Sequencing matters in one place — the token contract lands before the sections, so no section is ever
authored against the dark palette and retro-fitted.

## Open Questions

- The exact wording of the concept statement needs the owner's sign-off. It is the load-bearing
  sentence on the page, and it should read as a deliberate product voice rather than a disclaimer.
- The reference's remaining aspirational claims — "Production Live on Base", the guarantee language,
  and the four illustrative asset series — are retained under the concept framing by decision. They
  are listed here so that decision is reviewed once more against the page as built, rather than
  inherited silently from the reference.
- Whether the webfonts are loaded from the Google Fonts CDN or self-hosted. The CDN is assumed for
  now; self-hosting removes a third-party request and is the better end state if the page is ever
  presented offline.
