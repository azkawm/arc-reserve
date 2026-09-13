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
 * Only Chromium is installed (`npx playwright install chromium`). These are layout assertions
 * against standard CSS behaviour, not engine-specific rendering quirks, so one engine is a
 * deliberate scope choice, not an oversight.
 *
 * There is no CI in this repository (see frontend/README.md), so `npm run test:e2e` is a local
 * command run by habit, not a gate anything enforces automatically.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
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
