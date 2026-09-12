import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClosingCta } from "@/components/landing/closing-cta";

describe("ClosingCta", () => {
  it("carries no audit or attestation claim", () => {
    render(<ClosingCta />);
    for (const term of [/halborn/i, /verisol/i, /audit/i, /attested/i]) {
      expect(screen.queryByText(term)).not.toBeInTheDocument();
    }
  });

  it("does not misstate who may participate", () => {
    render(<ClosingCta />);
    expect(screen.queryByText(/restricted to accredited/i)).not.toBeInTheDocument();
    expect(screen.getByText(/retail, accredited, and institutional/i)).toBeInTheDocument();
  });

  it("both calls to action resolve to sections that exist on this page", () => {
    render(<ClosingCta />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href");
      expect(href).toMatch(/^#/);
      expect(href).not.toBe("#"); // the reference's bare "#" download link
    }
  });
});
