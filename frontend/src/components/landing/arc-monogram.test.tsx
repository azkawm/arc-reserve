import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcMonogram } from "@/components/landing/arc-monogram";

describe("ArcMonogram", () => {
  it("renders as a labelled, self-contained image with no external reference", () => {
    const { container } = render(<ArcMonogram />);
    const svg = screen.getByRole("img", { name: "ArcReserve" });
    expect(svg.tagName.toLowerCase()).toBe("svg");

    // No <image>/<use> element and no href/src that could point off-page — this is the concrete
    // check behind the spec's "Logo is local" scenario.
    expect(container.querySelector("image, use")).toBeNull();
    expect(container.innerHTML).not.toMatch(/https?:\/\//);
  });
});
