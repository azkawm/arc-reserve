import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A local "this figure is invented" marker for data-bearing panels (concept-landing-page spec,
 * "Mockup figures are not presented as live data").
 *
 * This is deliberately not `DataSourceBadge`. That component answers "where did this number
 * come from" for a value that travelled through the `/v1` client or the fixture adapter — every
 * one of its three states describes a real provenance. These panels never called the client at
 * all, so labelling them `mock` would claim a fixture pipeline that does not exist here and
 * would blur the one distinction D-019 exists to protect. `ConceptMarker` shares the pill
 * silhouette so it reads as the same family of "here's what this number is" affordance, but
 * its dashed border, its own icon (never `FlaskConical`, which `DataSourceBadge` already owns
 * for "mock"), and its neutral ink tone keep it visually a different claim.
 */
export function ConceptMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "border-dusk/35 bg-linen text-dusk inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed px-2 py-1 text-[10px] font-bold tracking-wide uppercase",
        className,
      )}
      title="Illustrative figure — not read from the deployed protocol"
    >
      <Lightbulb size={11} aria-hidden="true" />
      Concept
    </span>
  );
}
