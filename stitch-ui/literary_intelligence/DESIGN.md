---
name: Literary Intelligence
colors:
  surface: '#f9faf7'
  surface-dim: '#d9dad8'
  surface-bright: '#f9faf7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f1'
  surface-container: '#edeeeb'
  surface-container-high: '#e7e8e6'
  surface-container-highest: '#e2e3e0'
  on-surface: '#191c1b'
  on-surface-variant: '#47464b'
  inverse-surface: '#2e312f'
  inverse-on-surface: '#f0f1ee'
  outline: '#78767c'
  outline-variant: '#c8c5cc'
  surface-tint: '#5e5d69'
  primary: '#070710'
  on-primary: '#ffffff'
  primary-container: '#1f1f29'
  on-primary-container: '#878693'
  inverse-primary: '#c7c5d3'
  secondary: '#00668a'
  on-secondary: '#ffffff'
  secondary-container: '#74cefe'
  on-secondary-container: '#005776'
  tertiary: '#0c0801'
  on-tertiary: '#ffffff'
  tertiary-container: '#252011'
  on-tertiary-container: '#908773'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3e1ef'
  primary-fixed-dim: '#c7c5d3'
  on-primary-fixed: '#1b1b25'
  on-primary-fixed-variant: '#464651'
  secondary-fixed: '#c3e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#ece2ca'
  tertiary-fixed-dim: '#d0c6af'
  on-tertiary-fixed: '#201b0d'
  on-tertiary-fixed-variant: '#4d4635'
  background: '#f9faf7'
  on-background: '#191c1b'
  surface-variant: '#e2e3e0'
  parchment: '#fefffc'
  paper: '#ffffff'
  linen: '#f9faf7'
  ink-black: '#171717'
  graphite: '#2c2c2c'
  charcoal: '#444141'
  ash: '#646464'
  fog: '#b4b8b4'
  mist: '#dee2de'
  twilight: '#282834'
  dusk: '#1f1f29'
  signal-blue: '#41a1cf'
  cerulean: '#0081c0'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 52px
    fontWeight: '400'
    lineHeight: 60px
    letterSpacing: -0.04em
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '400'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 30px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  caption:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

# General Intelligence Company — Style Reference
> Literary journal beside a bonfire
**Theme:** light
General Intelligence Company uses an editorial, almost literary visual language: a warm off-white canvas interrupted by hand-painted atmospheric illustrations (moonlit skylines, wildflower meadows) that do the emotional work, while the actual UI lives on clean white between these scenes. Typography carries the brand — a custom display serif (ppmondwest) speaks in a low, measured voice at 48–54px with tight -0.04em tracking, while a custom sans (af) handles everything utilitarian at 13–18px. Color is nearly absent: a warm parchment white, a soft green-gray border, and one vivid blue (#41a1cf) used only as an outlined action border. Components whisper — 4px and 8px radii, hairline 1px borders, subtle backdrop-blur on the navigation, no decorative shadows.
## Tokens — Colors
| Name | Value | Token | Role |
|------|-------|-------|------|
| Parchment | `#fefffc` | `--color-parchment` | Page canvas — warm off-white slightly creamier than pure white, gives the whole site its book-page atmosphere |
| Paper | `#ffffff` | `--color-paper` | Card surfaces, section backgrounds, footer — the slightly cooler clean white used for elevated content areas |
| Linen | `#f9faf7` | `--color-linen` | Input fields, subtle surface wash, nav fill — barely-perceptible off-white that reads as neutral |
| Ink Black | `#171717` | `--color-ink-black` | Primary foreground token, strong body text where maximum contrast is needed |
| Graphite | `#2c2c2c` | `--color-graphite` | Headlines and key body text — softer than pure black, pairs with the warm canvas |
| Charcoal | `#444141` | `--color-charcoal` | Secondary text, button text — the workhorse text tone for body copy and UI labels |
| Ash | `#646464` | `--color-ash` | Muted helper text, descriptive copy, subdued UI |
| Fog | `#b4b8b4` | `--color-fog` | Tertiary borders, disabled states, lightest neutral in the scale |
| Mist | `#dee2de` | `--color-mist` | Hairline borders on cards, buttons, and section dividers — green-tinted to harmonize with illustrations |
| Twilight | `#282834` | `--color-twilight` | Near-black with a cool blue undertone — used for nav borders, icon strokes, and outlined actions; reads darker than its lightness suggests |
| Dusk | `#1f1f29` | `--color-dusk` | Filled button background — a near-black with cool violet undertone, the only non-white filled surface in the system |
| Signal Blue | `#41a1cf` | `--color-signal-blue` | Blue accent for outlined action borders, linked labels, and lightweight interactive emphasis. Do not promote it to the primary CTA color |
| Cerulean | `#0081c0` | `--color-cerulean` | Vivid blue used for a singular saturated card surface — the lone moment of pure color intensity, used sparingly as atmospheric punctuation |
