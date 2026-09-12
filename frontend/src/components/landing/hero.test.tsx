import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/landing/hero";

// Hero renders ShaderBackground, which probes for a WebGL context. jsdom has no WebGL and logs
// a console warning on every attempt; stubbing it to the same "unavailable" result it already
// falls back to keeps these tests focused on Hero's own copy and structure.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hero", () => {
  it("renders the product tagline", () => {
    render(<Hero />);
    const heading = screen.getByRole("heading", { level: 1 });
    // Two assertions rather than one combined string: a <br> between the two halves of the
    // tagline collapses to zero whitespace in the DOM's flattened text content.
    expect(heading).toHaveTextContent(/real assets/i);
    expect(heading).toHaveTextContent(/programmable liquidity/i);
  });

  it("does not claim a production or mainnet deployment", () => {
    render(<Hero />);
    expect(screen.queryByText(/production live/i)).not.toBeInTheDocument();
  });

  it("does not use guarantee language for the reserve mechanism", () => {
    render(<Hero />);
    expect(screen.queryByText(/guarantee/i)).not.toBeInTheDocument();
  });

  it("marks the status pill as a concept figure", () => {
    render(<Hero />);
    expect(screen.getByText("Concept")).toBeInTheDocument();
  });

  it("both calls to action resolve to in-page anchors", () => {
    render(<Hero />);
    for (const name of [/explore the concept/i, /protocol architecture/i]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toMatch(/^#/);
    }
  });
});
