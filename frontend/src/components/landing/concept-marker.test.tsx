import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConceptMarker } from "@/components/landing/concept-marker";

describe("ConceptMarker", () => {
  it("renders the concept label", () => {
    render(<ConceptMarker />);
    expect(screen.getByText("Concept")).toBeInTheDocument();
  });

  it("carries a title explaining the marker for assistive tech and hover", () => {
    render(<ConceptMarker />);
    expect(screen.getByTitle(/illustrative figure/i)).toBeInTheDocument();
  });

  it("accepts a className without dropping its own classes", () => {
    render(<ConceptMarker className="mt-4" />);
    const marker = screen.getByText("Concept").closest("span");
    expect(marker).toHaveClass("mt-4");
    expect(marker).toHaveClass("rounded-full");
  });
});
