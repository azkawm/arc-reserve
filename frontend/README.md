# ArcReserve frontend

React + Vite + TypeScript, Tailwind CSS v4, shadcn/ui, Vitest, Docker.

Hackathon demo, testnet only. Nothing here moves real funds.

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Build | Vite 8 + React 19 | SPA; no server rendering |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` | No `tailwind.config.*`; the theme lives in `src/index.css` |
| Components | shadcn/ui (`new-york`), Radix, lucide icons | `src/components/ui/` is generated; edit deliberately |
| Data | `@tanstack/react-query` against the backend `/v1` API | `src/lib/api.ts`, `src/lib/queries.ts` |
| Wallet | wagmi + viem, injected connector | `src/lib/wagmi.ts` |
| Tests | Vitest + Testing Library, jsdom | `npm test` |
| Container | Multi-stage Docker, nginx runtime | `Dockerfile`, `docker-compose.yml` |

## Commands

```bash
npm install
cp .env.example .env.local   # optional; without VITE_API_URL the app runs on fixtures

npm run dev                  # http://localhost:3000
npm run typecheck
npm run lint
npm test                     # or: npm run test:watch, npm run test:coverage
npm run build                # typecheck + bundle into dist/
npm run preview
```

The dev server is pinned to port **3000** (`strictPort`). That is not cosmetic: the backend's
`CORS_ORIGIN` defaults to `http://localhost:3000`, so serving the app from another port makes
every `/v1` read fail in the browser.

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

## What is here, and what is not

Present: the toolchain, the theme, the `/v1` client, the fixture adapter, the provenance
components, the wagmi + react-query providers, and a landing page that exercises all of it.

Not ported yet from the previous Next.js app: the marketplace, asset, issuer, verifier, and
engine routes, the candle and engine charts, the wallet write panels (buy, claim, redeem,
issuer and verifier actions, keeper range calls), and routing itself. The previous
implementation is in git history before this change; see `docs/FRONTEND.md`.
