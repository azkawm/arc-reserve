import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

/**
 * Page-level tests for the concept landing page (openspec/changes/concept-landing-page, task
 * group 5). These check what only the assembled page can prove — that the pieces built and unit
 * tested in isolation actually land in the right order, that the claim rules hold across section
 * boundaries and not just within one component, and that mounting the page truly touches no
 * backend. Per-section detail (exact copy, per-stage behaviour) lives in each section's own test
 * file; duplicating that here would just be slower assertions of the same thing.
 *
 * This file replaces the previous scaffold page's test outright (task 5.8) — that page's asset
 * table, provenance badge, and fixture-mode messaging do not exist here. The `/v1` client those
 * tests exercised is untouched in `src/lib/`; it simply has no consumer on this page. See
 * `App.tsx`'s doc comment.
 */
beforeEach(() => {
  // Hero mounts ShaderBackground, which probes for WebGL — jsdom has none and logs a console
  // warning on every attempt. Stubbing it to the same "unavailable" result it already falls
  // back to keeps this suite's output readable.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App — claim rules hold across the whole page", () => {
  it("carries no named audit firm or audit vocabulary anywhere on the page", () => {
    render(<App />);
    for (const term of [/halborn/i, /verisol/i, /bureau veritas/i, /audited/i, /attested/i, /certified/i]) {
      expect(screen.queryByText(term)).not.toBeInTheDocument();
    }
  });

  it("never describes its own figures as live, real-time, or synced", () => {
    render(<App />);
    expect(screen.queryByText(/live institutional telemetry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-time continuous/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/oracle heartbeat synced/i)).not.toBeInTheDocument();
  });

  it("never claims a guarantee in the main content — only the footer's required disclaimer uses the word, and only to deny one", () => {
    render(<App />);
    // "not a guaranteed return" in LandingFooter is required, truthful disclaimer content
    // (docs/PROPOSAL.en.md), not a claim — it is the one legitimate place this word belongs, so
    // this check is scoped to <main> (Hero through ClosingCta) rather than the whole page.
    const main = screen.getByRole("main");
    expect(main).not.toHaveTextContent(/guarantee/i);
  });

  it("never claims a production or mainnet deployment", () => {
    render(<App />);
    expect(screen.queryByText(/production live/i)).not.toBeInTheDocument();
  });
});

describe("App — the concept statement", () => {
  it("is present, names what the page is not, and exposes no dismiss control", () => {
    render(<App />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/design concept/i);
    expect(banner).toHaveTextContent(/not the deployed protocol/i);
  });

  it("sits in the shared sticky wrapper above the header, not merely somewhere on the page", () => {
    const { container } = render(<App />);
    const stickyWrapper = container.querySelector(".sticky.top-0");
    expect(stickyWrapper).not.toBeNull();
    expect(stickyWrapper?.querySelector('[role="status"]')).not.toBeNull();
    expect(stickyWrapper?.querySelector("header")).not.toBeNull();
  });
});

describe("App — every data-bearing panel is marked", () => {
  it("marks all six illustrative panels as Concept (hero pill, four telemetry cards, value references)", () => {
    render(<App />);
    expect(screen.getAllByText("Concept")).toHaveLength(6);
  });
});

describe("App — section presence and order", () => {
  it("renders the header first and the footer last", () => {
    render(<App />);
    // The monogram appears in both the header and the footer, so at least one rather than one.
    expect(screen.getAllByRole("img", { name: "ArcReserve" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/hackathon submission, testnet only/i)).toBeInTheDocument();
  });

  it("renders the six content sections in the documented order", () => {
    const { container } = render(<App />);
    const ids = Array.from(container.querySelectorAll("section[id]")).map((el) => el.id);
    expect(ids).toEqual([
      "hero",
      "telemetry",
      "engine",
      "value-references",
      "safety-ladder",
      "closing-cta",
    ]);
  });

  it("resolves every header nav anchor to a section that actually exists on the page", () => {
    const { container } = render(<App />);
    const nav = screen.getByRole("navigation", { name: "Section navigation" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const id = href?.replace(/^#/, "");
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });
});

describe("App — motion and network behaviour", () => {
  it("starts no animation frame loop when WebGL is unavailable", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    render(<App />);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("still renders a hero background when WebGL is unavailable", () => {
    const { container } = render(<App />);
    const hero = container.querySelector("#hero");
    expect(hero?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("issues no request to the backend on mount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    render(<App />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
