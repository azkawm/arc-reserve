import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingFooter } from "@/components/landing/landing-footer";

describe("LandingFooter", () => {
  it("restates the accurate disclaimer, not the Stitch colophon's claims", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/not a guaranteed return/i)).toBeInTheDocument();
    expect(screen.getByText(/no audit has been performed/i)).toBeInTheDocument();
  });

  it("does not repeat the reference's invented health-ratio figure", () => {
    render(<LandingFooter />);
    expect(screen.queryByText(/sinking fund health ratio/i)).not.toBeInTheDocument();
  });
});
