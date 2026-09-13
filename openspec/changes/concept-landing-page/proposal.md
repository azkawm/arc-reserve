## Why

ArcReserve's public surface is a scaffold page that exists to prove the Vite rebuild works (D-035).
It does not tell the product's story, and it is the first thing a hackathon judge sees. A Stitch
design for that story already exists in `stitch-ui/`, including two sections — the five independent
value references and the four-stage safety escalation ladder — that describe behaviour this protocol
genuinely implements.

The design cannot be shipped verbatim. Its copy asserts an audit that has not happened, a production
deployment that does not exist, guarantees the product explicitly disclaims, and four asset series
that were never issued. This change takes the design's structure and visual system, presents it as an
openly labelled design concept, and removes the one claim that is not defensible under any framing.

## What Changes

- **BREAKING (visual):** the app's dark `--arc-*` palette is replaced app-wide by the Stitch light
  design system — parchment ground, ink-black text, cerulean accent, Inter + Newsreader type, and a
  much tighter radius scale. This reverses the D-035 decision to keep the palette stable across the
  build-tool migration, so it needs its own decision record.
- **BREAKING (content):** `frontend/src/App.tsx` is replaced. The current page is the only consumer
  of the `/v1` client, so after this change nothing in the app reads the backend until the deep-dive
  lands. `src/App.test.tsx` is rewritten against the new page.
- A concept landing page at `/` carrying: header, hero with a WebGL canvas background, telemetry
  band, Dual Participant Engine, Five Independent Value References, Four-Stage Safety Escalation
  Ladder, closing CTA, and footer. Navigation is in-page anchors.
- Every figure on the page is a mockup. The page carries a persistent, non-dismissible concept label,
  and each data-bearing panel is locally marked, so no number can be mistaken for live protocol state.
- The fabricated audit attribution ("Dual Halborn & VeriSol Audited") is removed outright, and the
  telemetry heading loses the word "Live".
- Motion arrives: the ported WebGL hero shader, section scroll-reveals, and hover/focus
  micro-interactions — all of which stop under `prefers-reduced-motion`.
- Playwright joins Vitest. Vitest covers unit behaviour (positive, negative, edge); Playwright covers
  layout at phone, tablet and desktop viewports, which jsdom cannot do at all.

## Capabilities

### New Capabilities

- `concept-landing-page`: what the public landing page contains, how it must label itself as a
  concept, which claims it may not make, and how it must behave across viewports and under
  reduced-motion.
- `stitch-design-system`: the token contract for the app's visual system — colour, typography, radius
  — and the constraint that the three data-provenance colours stay mutually distinguishable on the
  new light ground.

### Modified Capabilities

None. `openspec/specs/` is empty; this is the repository's first change proposal.

## Impact

- **Replaced:** `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, the palette and font tokens in
  `frontend/src/index.css`.
- **Inherited:** the eight generated components in `frontend/src/components/ui/` are token-driven, so
  they follow the new palette automatically — but the radius change (`0.625rem` → `0.125rem`) alters
  their appearance materially and needs a visual pass.
- **Untouched:** `frontend/src/lib/` in full. The `/v1` client, react-query bindings, fixture adapter
  and formatters keep working; they simply have no consumer until the deep-dive change.
- **New dependencies:** `@playwright/test` plus its browser download. `Newsreader` is added to the
  existing Google Fonts load. No icon-font dependency — the design's Material Symbols are mapped onto
  the `lucide-react` already installed.
- **Assets:** the design's remote logo (`lh3.googleusercontent.com`) is replaced by the self-contained
  wordmark in `stitch-ui/arcreserve_monogram_wordmark/code.html`. The landing page must load no
  third-party image.
- **Docs:** `CLAUDE.md`, `docs/FRONTEND.md`, `docs/TESTING.md` and `docs/DECISIONS.md` are updated in
  this change, per the repository's rule that documentation moves with the code.
- **Deferred to a follow-up change:** the SOLAR01 deep-dive, the Yield & Floor Simulator, the
  offerings table, and all `/v1` wiring.
