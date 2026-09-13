import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * jsdom does not implement `matchMedia` at all, so every case here installs its own stub rather
 * than relying on a real browser preference — that stub is standing in for the OS setting this
 * hook exists to read.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  // A plain mutable record, not typed as `MediaQueryList` — that interface declares `matches`
  // readonly, which is true of the real DOM object but not of this stand-in, which needs to
  // flip it to simulate the OS setting changing underneath the hook.
  const state = { matches };

  const mql = {
    get matches() {
      return state.matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

  return {
    fire(nextMatches: boolean) {
      state.matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reads true when the OS preference is set", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("reads false when the OS preference is not set", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates live when the OS preference changes without a remount", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      media.fire(true);
    });
    expect(result.current).toBe(true);
  });

  it("defaults to motion-allowed when matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
