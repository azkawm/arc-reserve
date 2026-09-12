import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Fades and lifts its children into place the first time they scroll into view.
 *
 * Per the concept-landing-page spec's "Motion is decorative and interruptible" requirement,
 * content must never depend on this running: it fails toward "already visible", never toward
 * "stuck hidden". That governs two branches here, not just the obvious one —
 *
 * - reduced motion: content starts revealed and no observer is ever created.
 * - no `IntersectionObserver` in this environment (an old browser, or a test that has not
 *   stubbed one): content also starts revealed, rather than waiting forever on an API that does
 *   not exist. This is what keeps every section readable in the current Vitest/jsdom setup,
 *   which implements neither `IntersectionObserver` nor `ResizeObserver` — see
 *   `scroll-reveal.test.tsx` for the case that does stub one, to exercise the real reveal path.
 *
 * The reveal is one-way: once shown, an element does not re-hide on scrolling away. Content
 * that vanishes again on a small scroll wobble reads as broken, not as polish.
 *
 * Screenshot gotcha, confirmed while visually checking this page: a naive full-page screenshot
 * (resize the viewport to the full document height, then capture once, with no real scroll in
 * between) can catch every below-the-fold `ScrollReveal` still at `opacity-0`, because the
 * resize itself does not reliably give `IntersectionObserver` a chance to fire and React a
 * chance to re-render before the capture happens. This is a property of that capture method,
 * not a rendering bug — confirmed by both a normal incremental scroll and a direct anchor-nav
 * jump, each of which reveals every section within one CSS transition (700ms). A tool that
 * screenshots this page (a PR preview, a design review) should scroll through it first.
 */
export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const ref = useRef<HTMLDivElement>(null);
  // Whether the element has been observed intersecting. `revealed` below also accounts for the
  // two fail-open cases directly, so this only ever needs to move false -> true from inside the
  // observer's own callback — never set synchronously from the effect body itself.
  const [intersected, setIntersected] = useState(false);
  const revealed = prefersReducedMotion || !hasObserver || intersected;

  useEffect(() => {
    if (prefersReducedMotion || !hasObserver) {
      return;
    }
    const el = ref.current;
    if (el === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting === true) {
          setIntersected(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [prefersReducedMotion, hasObserver]);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
