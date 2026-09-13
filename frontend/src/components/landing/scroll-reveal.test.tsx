import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

vi.mock("@/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const mockedUsePrefersReducedMotion = vi.mocked(usePrefersReducedMotion);

afterEach(() => {
  mockedUsePrefersReducedMotion.mockReturnValue(false);
  vi.unstubAllGlobals();
});

describe("ScrollReveal", () => {
  it("renders its children regardless of reveal state — content is never hidden, only styled", () => {
    render(
      <ScrollReveal>
        <p>Section content</p>
      </ScrollReveal>,
    );
    expect(screen.getByText("Section content")).toBeInTheDocument();
  });

  it("starts already revealed when IntersectionObserver does not exist in this environment", () => {
    // The default Vitest/jsdom environment has no IntersectionObserver at all — this is that
    // case, exercised without any stub, which is the fail-open path the component must take.
    expect(typeof IntersectionObserver).toBe("undefined");
    render(
      <ScrollReveal>
        <p>Section content</p>
      </ScrollReveal>,
    );
    expect(screen.getByText("Section content").parentElement).toHaveClass("opacity-100");
  });

  it("starts already revealed under reduced motion, even when an observer is available", () => {
    mockedUsePrefersReducedMotion.mockReturnValue(true);
    vi.stubGlobal("IntersectionObserver", makeObserverStub().Ctor);

    render(
      <ScrollReveal>
        <p>Section content</p>
      </ScrollReveal>,
    );
    expect(screen.getByText("Section content").parentElement).toHaveClass("opacity-100");
  });

  it("waits for intersection before revealing, then reveals, when an observer is available", () => {
    const stub = makeObserverStub();
    vi.stubGlobal("IntersectionObserver", stub.Ctor);

    render(
      <ScrollReveal>
        <p>Section content</p>
      </ScrollReveal>,
    );

    expect(screen.getByText("Section content").parentElement).toHaveClass("opacity-0");

    act(() => {
      stub.fireIntersecting();
    });

    expect(screen.getByText("Section content").parentElement).toHaveClass("opacity-100");
  });
});

/** A minimal IntersectionObserver stand-in: captures its callback so a test can fire it. */
function makeObserverStub() {
  let callback: IntersectionObserverCallback | null = null;
  class Stub {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  return {
    Ctor: Stub as unknown as typeof IntersectionObserver,
    fireIntersecting() {
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
  };
}
