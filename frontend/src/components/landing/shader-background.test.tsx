import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShaderBackground } from "@/components/landing/shader-background";

vi.mock("@/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));

import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const mockedUsePrefersReducedMotion = vi.mocked(usePrefersReducedMotion);

afterEach(() => {
  mockedUsePrefersReducedMotion.mockReturnValue(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ShaderBackground — reduced motion", () => {
  it("mounts no canvas at all, so no frame loop can ever start", () => {
    mockedUsePrefersReducedMotion.mockReturnValue(true);
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    const { container } = render(<ShaderBackground />);

    expect(container.querySelector("canvas")).toBeNull();
    expect(rafSpy).not.toHaveBeenCalled();
  });
});

describe("ShaderBackground — no WebGL support", () => {
  it("falls back to the static background and starts no frame loop", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    const { container } = render(<ShaderBackground />);

    // A canvas is still mounted (reduced motion is off), but it stays fully transparent —
    // the static gradient underneath is what a viewer actually sees.
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveClass("opacity-0");
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("unmounts cleanly with no listeners left dangling", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { unmount } = render(<ShaderBackground />);
    expect(() => unmount()).not.toThrow();
  });
});

describe("ShaderBackground — full lifecycle with WebGL available", () => {
  it("starts the frame loop once visible, and stops it when the context is lost", () => {
    const observers = installObserverStubs();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      createFakeGlContext() as unknown as RenderingContext,
    );
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const { container } = render(<ShaderBackground />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveClass("opacity-100");
    expect(rafSpy).not.toHaveBeenCalled(); // not intersecting yet — no loop until confirmed visible

    act(() => {
      observers.fireIntersecting(true);
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);

    act(() => {
      canvas!.dispatchEvent(new Event("webglcontextlost"));
    });
    expect(canvas).toHaveClass("opacity-0");
    expect(cancelSpy).toHaveBeenCalled();
  });
});

/** Stubs ResizeObserver and IntersectionObserver, exposing a way to fire an intersection. */
function installObserverStubs() {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  let intersectionCallback: IntersectionObserverCallback | null = null;
  class IntersectionObserverStub {
    constructor(cb: IntersectionObserverCallback) {
      intersectionCallback = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

  return {
    fireIntersecting(isIntersecting: boolean) {
      intersectionCallback?.(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    },
  };
}

/** A no-op WebGL context: every call succeeds, so the component's happy path can run for real. */
function createFakeGlContext() {
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    ARRAY_BUFFER: 3,
    STATIC_DRAW: 4,
    FLOAT: 5,
    TRIANGLE_STRIP: 6,
    COMPILE_STATUS: 7,
    LINK_STATUS: 8,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    viewport: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    drawArrays: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
  };
}
