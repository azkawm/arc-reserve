import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LandingHeader } from "@/components/landing/landing-header";

describe("LandingHeader", () => {
  it("links every nav item to an in-page anchor, never a route", () => {
    render(<LandingHeader />);
    const nav = screen.getByRole("navigation", { name: "Section navigation" });
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^#/);
    }
  });

  it("hides the mobile nav until the disclosure button is activated", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);

    expect(screen.queryByRole("navigation", { name: /mobile/i })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const mobileNav = screen.getByRole("navigation", { name: /mobile/i });
    expect(within(mobileNav).getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("closes the mobile nav after a link is activated", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    const mobileNav = screen.getByRole("navigation", { name: /mobile/i });
    await user.click(within(mobileNav).getAllByRole("link")[0]!);

    expect(screen.queryByRole("navigation", { name: /mobile/i })).not.toBeInTheDocument();
  });
});
