import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConceptBanner } from "@/components/landing/concept-banner";

describe("ConceptBanner", () => {
  it("names both what the page is and what it is not", () => {
    render(<ConceptBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/design concept/i);
    expect(banner).toHaveTextContent(/not the deployed protocol/i);
  });

  it("exposes no dismiss, close, or hide control", () => {
    render(<ConceptBanner />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
