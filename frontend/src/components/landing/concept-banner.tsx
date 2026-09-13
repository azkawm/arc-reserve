import { Lightbulb } from "lucide-react";

/**
 * The statement this whole page's honesty rests on (concept-landing-page spec, "The page
 * identifies itself as a design concept").
 *
 * Every figure below this banner is invented, and several sections describe capital splits,
 * asset series, and safety triggers the deployed protocol does not implement. That is only
 * defensible while a reader cannot miss what the page actually is — so this is rendered inside
 * the page's shared `sticky top-0` wrapper (see `App.tsx`), stacked above the header, with no
 * close affordance. There is deliberately no dismiss button, no `aria-live="off"` escape hatch,
 * and no scroll-based fade: those would each reintroduce the exact failure mode — a reader who
 * scrolls past the one sentence that qualifies everything else on the page.
 */
export function ConceptBanner() {
  return (
    <div
      role="status"
      className="bg-dusk text-parchment flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium"
    >
      <Lightbulb size={14} className="text-signal-blue shrink-0" aria-hidden="true" />
      <span>
        Design concept — not the deployed protocol. Every figure on this page is illustrative.
      </span>
    </div>
  );
}
