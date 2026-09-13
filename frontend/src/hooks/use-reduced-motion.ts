import { useSyncExternalStore } from "react";

/**
 * `prefers-reduced-motion` as a live boolean, for the motion this stylesheet's blanket
 * `@media (prefers-reduced-motion: reduce)` rule cannot reach: a `requestAnimationFrame` loop.
 * A CSS media query can zero out a transition's duration; it cannot stop a canvas from
 * rendering. Anything that owns its own animation loop (the hero shader, in this change) reads
 * this hook and short-circuits before starting one.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` so the value is correct on the
 * very first render — no one-frame flash of motion before an effect catches up — and so it
 * updates live if the user toggles the OS setting while the page is open.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const QUERY = "(prefers-reduced-motion: reduce)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribe(onStoreChange: () => void): () => void {
  if (!hasMatchMedia()) {
    return () => {};
  }
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  if (!hasMatchMedia()) {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * No `window.matchMedia` in this environment (SSR, or a test that has not stubbed it) — default
 * to "motion allowed" rather than assume reduced motion on the user's behalf. Tests that care
 * about the reduced-motion branch stub `matchMedia` explicitly; see `use-reduced-motion.test.ts`.
 */
function getServerSnapshot(): boolean {
  return false;
}
