## ADDED Requirements

### Requirement: One token contract defines the app's visual system

The application's colour, typography and radius values SHALL be defined once as design tokens and
consumed everywhere through them. No component SHALL hardcode a brand colour, font family, or radius.

The visual system is the Stitch light direction: a parchment ground, ink-black text, and a cerulean
accent, replacing the previous dark ground and lime accent. Because the generated UI components are
token-driven, changing the tokens changes the whole application — that is the intent, and it means
the tokens are the only place this decision is recorded in code.

#### Scenario: Components inherit the palette without local overrides

- **WHEN** the generated UI components are rendered
- **THEN** their colours resolve from the shared tokens, and no component declares its own brand
  colour

#### Scenario: No dark-palette remnants

- **WHEN** the stylesheet is searched for the retired dark-ground and lime-accent values
- **THEN** no match is found

### Requirement: Provenance colours stay mutually distinguishable

The three data-provenance states — live, derived, and mock — SHALL remain visually distinct from each
other and legible against the ground they sit on. This survives the palette change unchanged in
intent: the failure mode is two provenance states that look alike, because that makes mock data
indistinguishable from real data at a glance.

The previous values were tuned for a dark ground and the new accent sits close to the old "derived"
blue, so all three MUST be re-chosen rather than carried over.

#### Scenario: Each provenance state is distinguishable from the others

- **WHEN** the live, derived, and mock indicators are rendered together
- **THEN** each is distinguishable from the other two by colour, and each also carries a non-colour
  cue so the distinction does not rely on colour alone

#### Scenario: Provenance text is legible on the ground

- **WHEN** a provenance indicator is rendered on the page background
- **THEN** its text meets the WCAG AA contrast threshold for its size

### Requirement: Typography uses a paired sans and serif

The system SHALL use a sans-serif for body and interface text and a serif for display headings, both
declared as tokens with real fallback stacks so the page stays legible before or without webfonts.

#### Scenario: Headings and body resolve to different families

- **WHEN** a display heading and a paragraph are rendered
- **THEN** the heading resolves to the serif token and the paragraph to the sans token

#### Scenario: Fallbacks are declared

- **WHEN** the font tokens are inspected
- **THEN** each names at least one generic fallback beyond the webfont

### Requirement: The reduced-motion rule applies application-wide

The stylesheet SHALL suppress animation, transition, and smooth scrolling for users who have
requested reduced motion, at the application level rather than per component.

#### Scenario: Reduced motion is honoured globally

- **WHEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** CSS animations, transitions, and smooth scrolling are suppressed across the application
