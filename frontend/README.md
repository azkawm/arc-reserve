# ArcReserve frontend

React + Vite + TypeScript, Tailwind CSS v4, shadcn/ui, Vitest, Playwright, Docker.

Hackathon demo, testnet only. Nothing here moves real funds.

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Build | Vite 8 + React 19 | SPA; no server rendering |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` | No `tailwind.config.*`; the theme lives in `src/index.css` (D-036: parchment/cerulean, not the earlier dark/lime palette) |
| Components | shadcn/ui (`new-york`), Radix, lucide icons | `src/components/ui/` is generated; edit deliberately |
| Data | `@tanstack/react-query` against the backend `/v1` API | `src/lib/api.ts`, `src/lib/queries.ts` — currently has no consumer; see below |
| Wallet | wagmi + viem, injected connector | `src/lib/wagmi.ts` |
| Tests | Vitest + Testing Library (jsdom), Playwright + Chromium | `npm test`, `npm run test:e2e` — see Testing below |
| Container | Multi-stage Docker, nginx runtime | `Dockerfile`, `docker-compose.yml` |

## Commands

```bash
npm install
cp .env.example .env.local   # optional; without VITE_API_URL the app runs on fixtures

npm run dev                  # http://localhost:3000
npm run typecheck
npm run lint
npm test                     # or: npm run test:watch, npm run test:coverage
npx playwright install chromium   # one-time, downloads the browser binary
npm run test:e2e             # or: npm run test:e2e:ui
npm run build                # typecheck + bundle into dist/
npm run preview
```

The dev server is pinned to port **3000** (`strictPort`). That is not cosmetic: the backend's
`CORS_ORIGIN` defaults to `http://localhost:3000`, so serving the app from another port makes
every `/v1` read fail in the browser. Playwright's `webServer` config starts (or reuses) that same
dev server automatically, so `npm run test:e2e` does not need it running separately first.

## The current page

`/` is a concept landing page (`openspec/changes/concept-landing-page`, D-036): a marketing-shaped
page built from a Stitch design reference (`../stitch-ui/`), covering the hero, illustrative
telemetry, the dual participant engine, the five independent value references, the four-stage
safety escalation ladder, and a closing call to action. It carries a persistent, non-dismissible
"design concept — not the deployed protocol" banner and a local concept marker on every illustrative
figure, and it calls the backend nowhere.

This means the `/v1` client, `src/lib/fixtures.ts`, and the provenance components below currently
have **no consumer** — they are intact and tested on their own, but nothing on the live page reads
through them. That is a deliberate, temporary trade: the SOLAR01 deep-dive that would exercise them
is deferred to a follow-up change (see `openspec/changes/concept-landing-page/design.md`,
Non-Goals).

The concept page also rewrites several of the Stitch reference's claims rather than reproducing them:
no audit or attestation attribution, no guarantee language, no "instant"/"live" self-description
where the real mechanism is reserve- or period-limited, and the real 60/25/10/5 ↔ 40/45/10/5 revenue
split rather than the reference's invented numbers. See `design.md`'s Decisions section for the full
list and the reasoning behind each one.

## Data provenance (D-019)

Fixture mode is a *configured* mode, never a fallback.

- No `VITE_API_URL` → panels read `src/lib/fixtures.ts` and every badge says **Mock**.
- `VITE_API_URL` set → panels read the API. A failed request renders an **error state**; it
  never quietly becomes a fixture, because a plausible number is indistinguishable from a true
  one.

`DataPanel` in `src/components/data-source.tsx` bundles the loading, error, and data states so
"I forgot the error case" is not reachable by omission. Use it instead of reading
`query.data` directly.

## Environment

Vite inlines `VITE_*` variables at build time and exposes nothing else. Consequences:

- Changing a variable needs a dev-server restart, and a **rebuild** for the Docker image.
- Everything in `.env.local` ships inside the bundle. Never put a secret there.
- The typed surface is `src/vite-env.d.ts`; keep it in step with `.env.example`.

## Docker

```bash
# Production image (static bundle behind nginx on host port 3000)
docker compose build
docker compose up -d

# Live-reload container instead
docker compose --profile dev up frontend-dev
```

`VITE_*` values are passed as **build args** in `docker-compose.yml`, for the reason above.
`VITE_API_URL` is resolved by the browser, so it points at the host (`http://127.0.0.1:4000`),
not at a compose service name.

The image was not built and run during scaffolding — no Docker daemon was available on the
machine it was authored on. `docker compose config` validates.

## Dependency notes

`package.json` carries one `overrides` entry:

```json
"overrides": { "use-sync-external-store": "^1.4.0" }
```

Without it, `npm install` prints a wall of `ERESOLVE overriding peer dependency` warnings. The cause
is four levels down: `@wagmi/connectors` → `@walletconnect/ethereum-provider` → `@reown/appkit` →
`valtio@1.13.2`, which pins `use-sync-external-store@1.2.0` — a version whose peer range stops at
React 18. Every *other* copy in the tree already resolved to 1.4.0, which does list React 19, so the
override just unifies them on a version that admits the React we actually run.

It is cosmetic, not a correctness fix: the tree only ever contained **one** React (`react@19.3.0`,
everything deduped to it), and the emitted bundle is byte-identical with and without the override.
Removing the entry brings the warnings back; it does not break the app.

The deprecation warnings that remain on install (`@walletconnect/*`, `@metamask/sdk`, `uuid@9`) come
from wagmi's connector dependencies and cannot be resolved from here.

## shadcn/ui

`components.json` is configured, so components can be added with:

```bash
npx shadcn@latest add <component>
```

One known wrinkle: the current CLI fails to resolve the `@/lib/utils` alias in this project and
emits `import { cn } from "cn"` (and installs an unrelated `cn` package). After adding a
component, rewrite that import to `@/lib/utils` and remove the stray dependency:

```bash
sed -i '' 's|from "cn"|from "@/lib/utils"|g' src/components/ui/*.tsx
npm uninstall cn
```

## Testing

Two runners, because they can prove different things.

**Vitest + Testing Library (jsdom)** — `npm test` — covers unit behaviour: component logic,
formatting, the concept page's claim rules (no audit vocabulary, no guarantee language, no "live"
self-description), and D-019's provenance rules. It cannot prove layout at all: jsdom has no CSS
cascade and no layout engine, so a `lg:flex` breakpoint class never computes and
`getBoundingClientRect()` returns zeros.

**Playwright + Chromium** — `npm run test:e2e`, config in `playwright.config.ts` — covers what only
a real browser can: no horizontal document overflow, navigation actually hiding/showing at the right
pixel widths, and wide content genuinely needing to scroll inside its own container rather than
merely being styled as if it would. Three viewport projects (phone 390px, tablet 768px, desktop
1440px); Chromium only, since these are standard CSS layout assertions rather than engine-specific
rendering. Playwright specs get their own `tsconfig.e2e.json`, separate from `tsconfig.node.json`,
because `page.evaluate()` callbacks run inside the real browser and reference `document` /
`getComputedStyle` directly — types those Node-only config files have no DOM lib to check against.

There is no CI in this repository, so `npm run test:e2e` is a local command run by habit, not a gate
anything enforces automatically.

One thing worth knowing if you screenshot this page (a PR preview, a design review): sections use
`ScrollReveal`, which fades content in via `IntersectionObserver` the first time it scrolls into
view. A naive full-page screenshot — resize the viewport to the full document height, capture once,
no scroll in between — can catch every below-the-fold section still at `opacity-0`, because the
resize alone does not reliably give the observer a chance to fire before the capture happens. Scroll
through the page first (or trigger a nav-anchor jump and wait ~1s for the CSS transition); see the
comment in `src/components/landing/scroll-reveal.tsx` for how this was confirmed.

## What is here, and what is not

Present: the toolchain, the theme (D-036's parchment/cerulean palette), the concept landing page
described above with its Vitest and Playwright coverage, and — separately, with no consumer on that
page — the `/v1` client, the fixture adapter, the provenance components, and the wagmi + react-query
providers.

Not built: the SOLAR01 deep-dive, the yield/floor simulator, and the offerings table from the Stitch
reference (deferred to a follow-up change). Not ported from the pre-D-035 Next.js app: the
marketplace, asset, issuer, verifier, and engine routes, the candle and engine charts, the wallet
write panels (buy, claim, redeem, issuer and verifier actions, keeper range calls), and routing
itself. That implementation is in git history before D-035; see `docs/FRONTEND.md`.
