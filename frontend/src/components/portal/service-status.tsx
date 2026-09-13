import { AlertTriangle, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import { useHealth } from "@/lib/queries";

/**
 * Global service state, from `/v1/health`.
 *
 * Three conditions matter and none of them is an error state:
 *  - `degraded` is normal for a poll or two during a catch-up;
 *  - a chain listed in `pendingBackfills` has knowingly incomplete compliance/identity/floor data;
 *  - a chain in `riskCoverage.notComputed` is *unknown, never safe* — it must not read as "no risk".
 *
 * Only `unhealthy` (status 503) is a banner-worthy failure, because then nothing truthful can be
 * served at all.
 */
export function ServiceStatus() {
  const { chainId } = useChain();
  const health = useHealth();

  if (health.isPending || health.data === undefined) {
    if (health.error instanceof ApiError && health.error.status === 503) {
      return <Banner tone="danger">Service unhealthy — data cannot be served truthfully right now.</Banner>;
    }
    return null;
  }

  const payload = health.data.data;
  const thisChain = chainName(chainId);
  const backfill = payload.pendingBackfills.find((row) => row.chainId === chainId);
  const riskUnknown = payload.riskCoverage.notComputed.find((row) => row.chainId === chainId);

  if (payload.status === "unhealthy") {
    return <Banner tone="danger">Service unhealthy — data cannot be served truthfully right now.</Banner>;
  }
  if (backfill !== undefined) {
    return (
      <Banner tone="warn">
        Syncing {thisChain}: compliance, identity and floor data may be incomplete until the
        backfill finishes.
      </Banner>
    );
  }
  if (riskUnknown !== undefined) {
    return <Banner tone="warn">Risk is not computed for {thisChain}. Unknown is not the same as safe.</Banner>;
  }
  if (payload.status === "degraded") {
    return (
      <Banner tone="warn">
        <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> Service degraded for{" "}
        {thisChain} — a catch-up may be running. Figures can lag briefly.
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5 text-destructive mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          : "border-provenance-mock/30 bg-provenance-mock/5 text-provenance-mock mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
      }
    >
      <AlertTriangle size={13} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
