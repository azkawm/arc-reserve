import { expect, test } from "@playwright/test";

/**
 * concept-landing-page spec, "The page is usable at phone, tablet and desktop widths" —
 * exercised in each of the phone / tablet / desktop projects defined in
 * `playwright.config.ts`.
 */

test("has no horizontal document overflow", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("navigation stays reachable — the desktop bar below lg, the disclosure button above it", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;
  const isDesktopWidth = viewportWidth >= 1024; // Tailwind's `lg` breakpoint (theme.css: 64rem)

  const desktopNav = page.getByRole("navigation", { name: "Section navigation" });
  const mobileToggle = page.getByRole("button", { name: /open navigation menu/i });

  if (isDesktopWidth) {
    await expect(desktopNav).toBeVisible();
  } else {
    // The horizontal nav is still in the DOM (it is only hidden by a CSS class, per
    // landing-header.tsx's own reasoning) — the requirement is that it is not the reachable
    // affordance at this width, and that the disclosure button is.
    await expect(desktopNav).toBeHidden();
    await expect(mobileToggle).toBeVisible();

    await mobileToggle.click();
    const mobileNav = page.getByRole("navigation", { name: /mobile/i });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link").first()).toBeVisible();
  }
});

test("the five-value-references table is set up to scroll within its own container, not the page", async ({
  page,
}) => {
  await page.goto("/");
  const tableContainer = page.locator('[data-slot="table-container"]').first();
  await tableContainer.scrollIntoViewIfNeeded();

  // A structural guarantee, independent of viewport width: if this table's content is ever
  // wider than its container, CSS alone contains the overflow locally. This is what makes the
  // page-wide "no horizontal overflow" check above hold even though the table itself has five
  // columns of tabular data that does not always fit a phone screen.
  const overflowX = await tableContainer.evaluate((el) => getComputedStyle(el).overflowX);
  expect(["auto", "scroll"]).toContain(overflowX);
});

test("the table container actually needs to scroll at phone width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the reference table fits without scrolling at wider widths");

  await page.goto("/");
  const tableContainer = page.locator('[data-slot="table-container"]').first();
  await tableContainer.scrollIntoViewIfNeeded();

  const { scrollWidth, clientWidth } = await tableContainer.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
});
