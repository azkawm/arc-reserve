import { expect, test } from "@playwright/test";

/**
 * launchpad-portal spec, "The portal is usable at phone, tablet and desktop widths" — exercised
 * in each of the phone / tablet / desktop projects in `playwright.config.ts`.
 *
 * Runs in fixture mode (`VITE_API_URL` unset), so the portal renders from `lib/fixtures.ts` with
 * every panel labelled `mock`; no backend is required. These cover what jsdom cannot: the CSS
 * cascade, real breakpoints, and actual layout width.
 */

const ROUTES = ["/offerings", "/assets/solar-indonesia-01"] as const;

test.describe("no horizontal document overflow", () => {
  for (const route of ROUTES) {
    test(`${route} does not widen the document`, async ({ page }) => {
      await page.goto(route);
      // Let the fixture-backed panels settle.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});

test("navigation and the chain switch stay reachable at every width", async ({ page }, testInfo) => {
  await page.goto("/offerings");

  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;
  const isDesktopWidth = viewportWidth >= 1024; // Tailwind `lg`

  const inlineNav = page.getByRole("navigation", { name: "Portal", exact: true });
  const toggle = page.getByRole("button", { name: /open navigation menu/i });
  const chainSwitch = page.getByRole("group", { name: "Network" });

  if (isDesktopWidth) {
    await expect(inlineNav).toBeVisible();
    await expect(toggle).toBeHidden();
  } else {
    await expect(inlineNav).toBeHidden();
    await expect(toggle).toBeVisible();

    await toggle.click();
    const mobileNav = page.getByRole("navigation", { name: /portal navigation \(mobile\)/i });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Offerings" })).toBeVisible();
  }

  await expect(chainSwitch).toBeVisible();
});

test("switching to Arc moves the whole portal and is reflected in the route", async ({ page }) => {
  await page.goto("/offerings");

  const chainSwitch = page.getByRole("group", { name: "Network" });
  const arc = chainSwitch.getByRole("button", { name: "Arc Testnet" });
  const hedera = chainSwitch.getByRole("button", { name: "Hedera Testnet" });

  await expect(hedera).toHaveAttribute("aria-pressed", "true");

  await arc.click();
  await expect(arc).toHaveAttribute("aria-pressed", "true");
  await expect(hedera).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/chainId=5042002/);
});

test("the landing page launches the portal", async ({ page }) => {
  await page.goto("/");

  // The concept landing page has no portal nav of its own; this button is the entry point.
  await page.getByRole("link", { name: /launch app/i }).first().click();

  await expect(page).toHaveURL(/\/offerings/);
  await expect(page.getByRole("heading", { name: /primary offerings/i })).toBeVisible();
});

test("the faucet page renders and fits the viewport", async ({ page }) => {
  await page.goto("/faucet");

  await expect(page.getByRole("heading", { name: /test musd faucet/i })).toBeVisible();
  // No wallet is injected in these tests, so the page explains what is needed.
  await expect(
    page.getByRole("button", { name: /connect a wallet to use the faucet/i }),
  ).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("the Trade button opens the swap desk", async ({ page }, testInfo) => {
  await page.goto("/offerings");

  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;
  if (viewportWidth >= 1024) {
    await page
      .getByRole("navigation", { name: "Portal", exact: true })
      .getByRole("link", { name: /trade/i })
      .click();
  } else {
    await page.getByRole("button", { name: /open navigation menu/i }).click();
    await page
      .getByRole("navigation", { name: /portal navigation \(mobile\)/i })
      .getByRole("link", { name: /trade/i })
      .click();
  }

  await expect(page).toHaveURL(/\/assets\/solar-indonesia-01/);
  await expect(page.getByRole("heading", { name: /swap/i })).toBeVisible();
});

test("the candlestick chart stays inside its own panel", async ({ page }) => {
  await page.goto("/assets/solar-indonesia-01");

  // Lightweight Charts renders to a canvas; it is lazy-loaded, so wait for it.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  const { canvasWidth, panelWidth } = await canvas.evaluate((element) => {
    const panel = element.closest("section");
    return {
      canvasWidth: element.getBoundingClientRect().width,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(panelWidth).toBeGreaterThan(0);
  expect(canvasWidth).toBeLessThanOrEqual(panelWidth + 1);
});

test("every header control stays within the viewport", async ({ page }, testInfo) => {
  await page.goto("/offerings");
  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;

  const controls = page
    .locator("header")
    .locator("a[aria-label='ArcReserve home'], button, [role='group']");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox();
    if (box === null) continue; // hidden at this width
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
});