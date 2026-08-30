"use client";

import { DataPanel, DataSourceBadge } from "@/components/data-source";
import { usePositions } from "@/lib/queries";
import { formatPrice } from "@/lib/format";
import type { PositionKind } from "@/lib/api";

/**
 * Market inventory by position.
 *
 * The fixture claimed "7,200 mUSD" per position. That number never existed: a Uniswap V3
 * position exposes a raw `uint128` of liquidity, and converting it to token amounts needs the
 * curve and the current price. So this panel shows the range and the raw liquidity, and says
 * plainly that per-position balances are not available — which is the truth until a real pool
 * is integrated.
 */

const LABEL: Record<PositionKind, string> = {
  ReserveFloor: "Market floor range",
  Anchor: "Anchor",
  Discovery: "Discovery",
  Intermediary: "Intermediary",
};

const CLASS: Record<PositionKind, string> = {
  ReserveFloor: "floor",
  Anchor: "anchor",
  Discovery: "discovery",
  Intermediary: "intermediary",
};

export function PositionLiquidity({
  assetId,
  embedded = false,
}: {
  assetId?: string;
  embedded?: boolean;
}) {
  const positions = usePositions(assetId);

  return (
    <section className={`${embedded ? "embedded " : "panel "}position-liquidity`}>
      <div className="position-liquidity-head">
        <div>
          <span className="eyebrow">MARKET INVENTORY</span>
          <h2>Liquidity by position</h2>
        </div>
        <DataSourceBadge {...(positions.data ? { meta: positions.data.meta } : {})} />
      </div>

      <DataPanel query={positions} loadingLabel="Loading positions">
        {(data) => (
          <>
            <div className="position-liquidity-grid">
              {data.positions.map((position) => (
                <div className={`liquidity-position ${CLASS[position.kind]}`} key={position.kind}>
                  <div className="liquidity-position-top">
                    <span>
                      <i /> {LABEL[position.kind]}
                    </span>
                    <b>{position.configured ? "Active" : "Unconfigured"}</b>
                  </div>
                  <strong>{position.liquidity === "0" ? "No liquidity" : `L ${position.liquidity}`}</strong>
                  <small>
                    {position.configured
                      ? `Ticks ${position.tickLower} → ${position.tickUpper}`
                      : "Not configured"}
                  </small>
                  <em>
                    {position.priceLower === null || position.priceUpper === null
                      ? "—"
                      : `${formatPrice(position.priceLower)} – ${formatPrice(position.priceUpper)} mUSD`}
                  </em>
                </div>
              ))}
            </div>
            <p>
              Liquidity is the position&apos;s raw <code>uint128</code>. Per-position token balances
              are not shown: converting liquidity to amounts requires the pool curve and the
              current price, so any figure here would be an estimate presented as a balance. The
              protected reserve is a separate bucket and can never be deployed into these ranges.
            </p>
          </>
        )}
      </DataPanel>
    </section>
  );
}
