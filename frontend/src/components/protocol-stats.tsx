"use client";

import { DataPanel, DataSourceBadge } from "@/components/data-source";
import { useAssets, useMetrics } from "@/lib/queries";
import { formatCompact } from "@/lib/format";

/**
 * The protocol statistics strip.
 *
 * Previously four hardcoded literals ("100,000 mUSD", "24,600 mUSD", "41,600 SOLAR01", "03").
 * Every one of them now traces to a read: the supply figures come from `/metrics`, the asset
 * count from the list, and the reserve from the vault's own category balance. A value that
 * cannot be computed renders a dash rather than a plausible number.
 */
export function ProtocolStats() {
  const assets = useAssets();
  const primary = assets.data?.data.find((asset) => asset.status === "Active");
  const metrics = useMetrics(primary?.assetId);

  return (
    <section className="market-stats" aria-label="Protocol statistics">
      <DataPanel query={assets} loadingLabel="Loading statistics">
        {(list, meta) => {
          const supply = metrics.data?.data.supply;
          const reserve = metrics.data?.data.reserve.redemptionReserve ?? primary?.reserve ?? null;
          const nav = metrics.data?.data.nav.value ?? null;

          return (
            <>
              <div>
                <span>
                  Authorized supply <DataSourceBadge meta={metrics.data?.meta ?? meta} />
                </span>
                <strong>{supply === undefined ? "—" : formatCompact(supply.maximum)}</strong>
                <small>{primary?.symbol ?? "—"} hard cap</small>
              </div>
              <div>
                <span>Protected reserve</span>
                <strong>{reserve === null ? "—" : `${formatCompact(reserve)} mUSD`}</strong>
                <small>Ring-fenced liquidity</small>
              </div>
              <div>
                <span>Issuance headroom</span>
                <strong>{supply === undefined ? "—" : formatCompact(supply.headroom)}</strong>
                <small>Unminted inside the cap</small>
              </div>
              <div>
                <span>Verified NAV</span>
                <strong>{nav === null ? "—" : `${nav.slice(0, nav.indexOf(".") + 4)} mUSD`}</strong>
                <small>
                  {list.length} asset{list.length === 1 ? "" : "s"} indexed
                </small>
              </div>
            </>
          );
        }}
      </DataPanel>
    </section>
  );
}
