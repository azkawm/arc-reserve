import { defineConfig, devices } from "@playwright/test";

/**
 * Layout tests: what Vitest + jsdom cannot prove at all.
 *
 * jsdom has no CSS cascade and no layout engine — `sm:`/`lg:` breakpoint classes never compute,
 * and `getBoundingClientRect()` returns zeros — so "the page is usable at phone, tablet and
 * desktop" (concept-landing-page spec) can only be tested in a real browser. This file is that
 * suite: no horizontal overflow, navigation adapting below the desktop breakpoint, and wide
 * content scrolling in its own container, at three real viewport widths.
 *
 * Only one engine is exercised. It uses the **system Chrome** (`channel: "chrome"`) rather than
 * the Playwright-downloaded Chromium: on this machine a Windows Application Control policy blocks
 * executables under `%LOCALAPPDATA%\ms-playwright`, so the downloaded browser cannot be spawned.
 * The assertions are about standard CSS layout, not engine-specific rendering, so the engine is a
 * deliberate scope choice either way. Run `npx playwright install chrome` if the channel is
 * missing.
 *
 * There is no CI in this repository (see frontend/README.md), so `npm run test:e2e` is a local
 * command run by habit, not a gate anything enforces automatically.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    channel: "chrome",
    baseURL: "http://localhost:4318",
    trace: "retain-on-failure",
  },
  webServer: {
    // A dedicated port, not the app's 3000: the default dev port is often already taken (Docker
    // on this machine maps 3000), and the e2e suite runs in fixture mode, so it does not need the
    // backend's CORS origin. Manual `npm run dev` still uses 3000.
    command: "npm run dev -- --port 4318 --strictPort",
    url: "http://localhost:4318",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    // The e2e suite is hermetic: override any VITE_API_URL in `.env.local` so the portal renders
    // from fixtures and does not depend on a running backend. Vite gives process env priority
    // over `.env` files, so an empty value here forces fixture mode.
    env: { ...(process.env as Record<string, string>), VITE_API_URL: "" },
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
