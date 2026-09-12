import { AlertTriangle, CircleDot, FlaskConical, Loader2, Sigma } from "lucide-react";
import type { Provenance, ResponseMeta } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Provenance and state, rendered so they cannot be forgotten.
 *
 * D-019 in one component: every panel says where its numbers came from, and a failed request
 * renders an error — never a fixture wearing a live badge. `DataPanel` bundles the three
 * states a panel can be in so that "I forgot the error case" is not reachable by omission.
 */

const LABEL: Record<Provenance, string> = {
  onchain: "Live",
  derived: "Derived",
  mock: "Mock",
};

const DESCRIPTION: Record<Provenance, string> = {
  onchain: "Read from the chain at the indexed block",
  derived: "Computed from indexed chain data",
  mock: "Demo fixture — not live market data",
};

/** Three provenances, three visibly different colours. Looking alike is the failure mode. */
const TONE: Record<Provenance, string> = {
  onchain: "border-provenance-live/25 bg-provenance-live/8 text-provenance-live",
  derived: "border-provenance-derived/25 bg-provenance-derived/8 text-provenance-derived",
  mock: "border-provenance-mock/25 bg-provenance-mock/8 text-provenance-mock",
};

export function DataSourceBadge({
  meta,
  provenance,
  className,
}: {
  meta?: ResponseMeta;
  /** Overrides the envelope's provenance for a field that carries its own (spot, TWAP). */
  provenance?: Provenance;
  className?: string;
}) {
  const effective: Provenance = provenance ?? meta?.provenance ?? "mock";
  const Icon = effective === "mock" ? FlaskConical : effective === "derived" ? Sigma : CircleDot;

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold tracking-wide uppercase",
        TONE[effective],
        className,
      )}
      title={DESCRIPTION[effective]}
    >
      <Icon size={11} aria-hidden="true" />
      {LABEL[effective]}
      {meta?.stale === true && effective !== "mock" && (
        <b
          className="border-current/30 ml-0.5 border-l pl-1.5 font-bold"
          title={`Indexed block ${meta.indexedBlock}${
            meta.asOf === null ? "" : `, ${formatRelative(meta.asOf)}`
          }`}
        >
          Stale
        </b>
      )}
    </span>
  );
}

export function PanelLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="text-muted-foreground flex items-center gap-2 py-6 text-xs"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={15} className="animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

/**
 * The error state that exists so a fixture never fills the gap. It names the failure rather
 * than showing a plausible number, because a plausible number is indistinguishable from a
 * true one.
 */
export function PanelError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const code = error instanceof ApiError ? error.code : "NETWORK";
  const explanation =
    code === "MOCK_DISABLED"
      ? "No canonical market data exists for this asset, and synthetic demo data is disabled."
      : code === "INDEXER_BEHIND"
        ? "The indexer has not caught up yet. Nothing is being shown rather than something stale."
        : code === "ASSET_NOT_FOUND"
          ? "This asset is not in the index."
          : "The backend could not be reached.";

  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle size={15} aria-hidden="true" />
      <AlertTitle>Unavailable</AlertTitle>
      <AlertDescription className="gap-2">
        <span>{explanation}</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * One panel, three states. Takes the query result directly so a caller cannot render data
 * while forgetting that the request might have failed.
 */
export function DataPanel<T>({
  query,
  children,
  loadingLabel,
}: {
  query: {
    data?: { data: T; meta: ResponseMeta } | undefined;
    error: Error | null;
    isPending: boolean;
    refetch: () => void;
  };
  children: (data: T, meta: ResponseMeta) => React.ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <PanelLoading {...(loadingLabel ? { label: loadingLabel } : {})} />;
  if (query.error !== null) return <PanelError error={query.error} onRetry={query.refetch} />;
  if (query.data === undefined) return <PanelError error={new Error("no data")} />;
  return <>{children(query.data.data, query.data.meta)}</>;
}
