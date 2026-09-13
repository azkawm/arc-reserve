import { DataSourceBadge } from "@/components/data-source";
import type { AssetMetrics, Provenance, ResponseMeta } from "@/lib/api";
import { formatPrice, formatRelative } from "@/lib/format";

/**
 * The four prices, kept four distinct values (CLAUDE.md product rule 4). Collapsing any two is
 * the failure this component exists to prevent:
 *  - spot is the instantaneous pool price, gated on `marketStatus === "ready"`;
 *  - NAV is verifier-published and carries an age;
 *  - the floor is a published reference, shown with its coverage;
 *  - the redemption price is `min(NAV, backing)` and is **not** the floor.
 */
export function PriceTiles({ m, meta }: { m: AssetMetrics; meta: ResponseMeta }) {
  const spotReady = m.marketStatus === "ready" && m.spot !== null;

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <PriceTile
        label="Spot"
        value={spotReady ? `${formatPrice(m.spot?.value.value)} mUSD` : "—"}
        caption={spotReady ? "pool price, no weighted average" : "market not ready"}
        provenance={m.spot?.provenance ?? meta.provenance}
      />
      <PriceTile
        label="Verified NAV"
        value={`${formatPrice(m.nav.value)} mUSD`}
        caption={`published ${formatRelative(m.nav.timestamp)}${m.nav.stale ? " · stale" : ""}`}
        provenance={meta.provenance}
        tone={m.nav.stale ? "warn" : undefined}
      />
      <PriceTile
        label="Published floor"
        value={m.floor === null ? "—" : `${formatPrice(m.floor.price)} mUSD`}
        caption={
          m.floor === null ? "no floor controller" : m.floor.covered ? "covered" : "not covered"
        }
        provenance={meta.provenance}
        tone={m.floor !== null && !m.floor.covered ? "warn" : undefined}
      />
      <PriceTile
        label="Redemption price"
        value={
          m.redemptionPrice.normal === null ? "—" : `${formatPrice(m.redemptionPrice.normal)} mUSD`
        }
        caption="min(NAV, backing) · not the floor"
        provenance={meta.provenance}
      />
    </div>
  );
}

function PriceTile({
  label,
  value,
  caption,
  provenance,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  provenance: Provenance;
  tone?: "warn" | undefined;
}) {
  return (
    <div className="bg-paper border-mist space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-1">
        <span className="text-ash text-[11px]">{label}</span>
        <DataSourceBadge provenance={provenance} />
      </div>
      <p className="text-ink text-lg font-semibold">{value}</p>
      <span className={tone === "warn" ? "text-provenance-mock text-[11px]" : "text-ash text-[11px]"}>
        {caption}
      </span>
    </div>
  );
}
