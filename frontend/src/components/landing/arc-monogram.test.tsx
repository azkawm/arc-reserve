import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcMonogram } from "@/components/landing/arc-monogram";

describe("ArcMonogram", () => {
  it("renders the logo mark from a local asset, with no third-party reference", () => {
    render(<ArcMonogram />);
    const img = screen.getByRole("img", { name: "ArcReserve" });
    expect(img.tagName.toLowerCase()).toBe("img");

    // The concept-landing-page spec's "Logo is local" scenario: no fetch to a remote host such as
    // lh3.googleusercontent.com. A root-relative path served from this app's own origin passes.
    const src = img.getAttribute("src") ?? "";
    expect(src).not.toMatch(/^https?:\/\//);

    expect(screen.getByText("ArcReserve")).toBeInTheDocument();
  });
});
