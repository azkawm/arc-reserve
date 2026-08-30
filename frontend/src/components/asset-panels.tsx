"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Copy, ShieldCheck, TrendingUp } from "lucide-react";
import { useAccount } from "wagmi";
import { StatusPill } from "@/components/ui";
import { DataPanel, DataSourceBadge, PanelError, PanelLoading } from "@/components/data-source";
import { PriceChart } from "@/components/price-chart";
import { PositionLiquidity } from "@/components/position-liquidity";
import { useAccountPosition, useAssetBySlug, useMetrics } from "@/lib/queries";
import { formatAmount, formatBps, formatDate, formatPercent, formatPrice, shortAddress } from "@/lib/format";

/**
 * The live panels of the asset page.
 *
 * Every number here used to be a literal in JSX. The rule applied throughout: a value that
 * cannot be computed renders a dash, never a plausible substitute — and where two numbers are
 * only meaningful together (the floor level and whether it is currently covered) they are
 * rendered together or not at all.
 */

export function AssetHero({ slug }: { slug: string }) {
  const { asset, query } = useAssetBySlug(slug);
  const metrics = useMetrics(asset?.assetId);

  if (query.isPending) return <PanelLoading label="Loading asset" />;
  if (query.error !== null) return <PanelError error={query.error} onRetry={query.refetch} />;
  if (asset === undefined) return <PanelError error={new Error("asset not indexed")} />;

  const nav = metrics.data?.data.nav.value ?? null;

  return (
    <section className="asset-market-header">
      <div className="asset-identity">
        <div className="asset-avatar solar large">
          <span>{asset.symbol.slice(0, 2)}</span>
        </div>
        <div>
          <div className="asset-title-line">
            <h1>{asset.name}</h1>
            <StatusPill tone={asset.status === "Active" ? "green" : "amber"}>
              <CheckCircle2 size={13} /> {asset.status}
            </StatusPill>
          </div>
          <div className="asset-subline">
            <strong>{asset.symbol}</strong>
            <span>{asset.category}</span>
            <button type="button" title={asset.contracts?.token ?? asset.assetId}>
              {shortAddress(asset.contracts?.token ?? asset.assetId)} <Copy size={11} />
            </button>
          </div>
        </div>
      </div>
      <div className="asset-head-price">
        <span>
          Market price{" "}
          <DataSourceBadge
            {...(query.data ? { meta: query.data.meta } : {})}
            {...(asset.spot ? { provenance: asset.spot.provenance } : {})}
          />
        </span>
        <strong>
          {formatPrice(asset.spot?.value ?? null)} <small>mUSD</small>
        </strong>
        {asset.spot !== null && nav !== null && (
          <b>
            <TrendingUp size={13} /> vs NAV {formatPrice(nav)}
          </b>
        )}
      </div>
    </section>
  );
}

export function AssetChartPanel({ slug }: { slug: string }) {
  const { assetId } = useAssetBySlug(slug);
  const metrics = useMetrics(assetId);

  const floor = metrics.data?.data.floorReference.value ?? null;
  const spot = metrics.data?.data.spot?.value.value ?? null;

  return (
    <section className="panel chart-panel market-chart-panel">
      <div className="market-chart-heading">
        <div>
          <span className="eyebrow">SOLAR01 / mUSD</span>
          <div className="chart-live-price">
            <strong>{formatPrice(spot)}</strong>
            <span>mUSD</span>
          </div>
        </div>
        <div className="floor-price-callout">
          <span>
            <ShieldCheck size={13} /> Protected floor reference
          </span>
          <strong>{formatPrice(floor)} mUSD</strong>
          <small>Reserve-limited, not a peg</small>
        </div>
      </div>

      <PriceChart {...(assetId ? { assetId } : {})} />

      <div className="chart-disclosure">
        <ShieldCheck size={14} />
        <p>
          The protected floor is a backing-aware reference based on verified NAV and liquid
          reserve per redeemable token. Redemption remains liquidity-limited.
        </p>
      </div>
    </section>
  );
}

export function SupplyStructure({ slug }: { slug: string }) {
  const { asset } = useAssetBySlug(slug);
  const metrics = useMetrics(asset?.assetId);

  return (
    <section className="panel supply-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CAPPED SERIES</span>
          <h2>Supply structure</h2>
        </div>
        <DataSourceBadge {...(metrics.data ? { meta: metrics.data.meta } : {})} />
      </div>

      <DataPanel query={metrics} loadingLabel="Loading supply">
        {(data) => {
          const { supply } = data;
          // Percentages for the bar, computed from the exact strings via BigInt so the widths
          // agree with the numbers printed beside them.
          const maximum = BigInt(supply.maximum.replace(".", ""));
          const share = (value: string): number => {
            if (maximum === 0n) return 0;
            const part = BigInt(value.replace(".", ""));
            return Number((part * 10_000n) / maximum) / 100;
          };
          const issuedShare = share(supply.issued);
          const headroomShare = share(supply.headroom);

          return (
            <>
              <div className="supply-summary">
                <div>
                  <span>Authorized supply</span>
                  <strong>{formatAmount(supply.maximum)}</strong>
                  <small>Hard cap</small>
                </div>
                <div>
                  <span>Issued supply</span>
                  <strong>{formatAmount(supply.issued)}</strong>
                  <small>Minted to date</small>
                </div>
                <div>
                  <span>Investor supply</span>
                  <strong>{formatAmount(supply.investor)}</strong>
                  <small>Backing denominator</small>
                </div>
                <div>
                  <span>Issuance headroom</span>
                  <strong>{formatAmount(supply.headroom)}</strong>
                  <small>Unminted inside the cap</small>
                </div>
              </div>

              <div className="supply-track" aria-label="Authorized supply allocation">
                <span className="supply-float" style={{ width: `${issuedShare}%` }} />
                <span className="supply-headroom" style={{ width: `${headroomShare}%` }} />
              </div>
              <div className="supply-legend">
                <span className="float">{issuedShare.toFixed(1)}% issued</span>
                <span className="headroom">{headroomShare.toFixed(1)}% issuance headroom</span>
              </div>

              <p className="supply-note">
                Headroom cannot be minted by the market maker. Future issuance requires verified
                demand, reserve solvency, and a disclosed allocation.
              </p>

              <div className="yield-rule">
                <div>
                  <span>Yield-eligible supply</span>
                  <strong>{formatAmount(supply.eligibleCirculating)} {asset?.symbol ?? ""}</strong>
                </div>
                <p>
                  Three denominators, not one: issued supply, investor supply (backing and
                  redemption), and yield-eligible supply (revenue). Excluded balances never enter
                  the yield denominator, and unminted headroom enters none of them.
                </p>
              </div>
            </>
          );
        }}
      </DataPanel>
    </section>
  );
}

/**
 * The protected floor card.
 *
 * D-025's published level is rendered only alongside its coverage flag. `isFloorCovered()` can
 * go false with no event and no state change — a NAV markdown can leave a valid level above
 * the new NAV — so a level shown alone would assert something the contract does not.
 */
export function FloorCard({ slug }: { slug: string }) {
  const { assetId } = useAssetBySlug(slug);
  const metrics = useMetrics(assetId);

  return (
    <section className="panel reserve-floor-card">
      <div className="reserve-card-head">
        <span>
          <ShieldCheck size={15} /> Protected floor reference
        </span>
        <DataSourceBadge {...(metrics.data ? { meta: metrics.data.meta } : {})} />
      </div>

      <DataPanel query={metrics} loadingLabel="Loading reserve">
        {(data) => (
          <>
            <div className="floor-primary">
              <span>Current reference</span>
              <strong>
                {formatPrice(data.floorReference.value)} <small>mUSD</small>
              </strong>
              <p>{data.floorReference.formula}</p>
            </div>

            {data.floor !== null && (
              <div className={`floor-level ${data.floor.covered ? "covered" : "uncovered"}`}>
                <div>
                  <span>Published floor level</span>
                  <strong>{formatPrice(data.floor.price)} mUSD</strong>
                </div>
                <StatusPill tone={data.floor.covered ? "green" : "amber"}>
                  {data.floor.covered ? "Covered" : "Not covered"}
                </StatusPill>
                <p>
                  {data.floor.covered
                    ? "The published level is at or below both NAV and current backing."
                    : "NAV or backing has fallen below the published level. The level does not fall; the ratchet pauses until both cover it again."}
                </p>
              </div>
            )}

            <div className="floor-stat-grid">
              <div>
                <span>Stable reserve</span>
                <strong>{formatAmount(data.reserve.redemptionReserve)} mUSD</strong>
              </div>
              <div>
                <span>Reserve ratio</span>
                <strong>{formatBps(data.reserve.reserveRatioBps)}</strong>
              </div>
              <div>
                <span>Minimum ratio</span>
                <strong>{formatBps(data.reserve.minimumReserveRatioBps)}</strong>
              </div>
              <div>
                <span>Solvent</span>
                <strong className={data.reserve.isSolvent ? "positive" : ""}>
                  {data.reserve.isSolvent ? "Yes" : "No"}
                </strong>
              </div>
            </div>

            {data.reserveSchedule !== null && (
              <div className="reserve-schedule">
                <div>
                  <span>Backing now</span>
                  <strong>{formatPrice(data.reserveSchedule.currentBacking)} mUSD</strong>
                </div>
                <div>
                  <span>Scheduled target</span>
                  <strong>{formatPrice(data.reserveSchedule.targetBackingNow)} mUSD</strong>
                </div>
                <StatusPill tone={data.reserveSchedule.behindSchedule ? "amber" : "green"}>
                  {data.reserveSchedule.behindSchedule ? "Behind schedule" : "On schedule"}
                </StatusPill>
              </div>
            )}

            <Link className="reserve-link" href="/engine">
              How the reference is calculated <ArrowLeft size={13} />
            </Link>
          </>
        )}
      </DataPanel>
    </section>
  );
}

/**
 * "Your position". Requires a connected wallet; without one it says so rather than showing a
 * demo holding, which is how the old fixture ended up asserting 12,500 SOLAR01 for everybody.
 */
export function HoldingsCard({ slug }: { slug: string }) {
  const { asset, assetId } = useAssetBySlug(slug);
  const { address, isConnected } = useAccount();
  const position = useAccountPosition(address, assetId);

  return (
    <section className="panel holdings-card">
      <div className="panel-heading">
        <h3>Your position</h3>
        {position.data && <DataSourceBadge meta={position.data.meta} />}
      </div>

      {!isConnected ? (
        <div className="panel-state empty">
          <span>Connect a wallet to see your position.</span>
        </div>
      ) : (
        <DataPanel query={position} loadingLabel="Loading position">
          {(data) => (
            <>
              <div>
                <span>Holdings</span>
                <strong>
                  {formatAmount(data.tokenBalance, 4)} {asset?.symbol ?? ""}
                </strong>
              </div>
              <div>
                <span>Claimable revenue</span>
                <strong className={data.claimable === "0.000000" ? "" : "positive"}>
                  {formatAmount(data.claimable)} mUSD
                </strong>
              </div>
              <div>
                <span>Verified investor (demo)</span>
                <strong className={data.verified ? "positive" : ""}>
                  {data.verified ? "Verified" : "Not verified"}
                </strong>
              </div>
              <div>
                <span>Remaining purchase allowance</span>
                <strong>{formatAmount(data.remainingWalletLimit)} mUSD</strong>
              </div>
              {data.redemptionQuote !== null && (
                <div>
                  <span>Redemption price</span>
                  <strong>{formatPrice(data.redemptionQuote.price)} mUSD</strong>
                </div>
              )}
            </>
          )}
        </DataPanel>
      )}
    </section>
  );
}

export function AssetFacts({ slug }: { slug: string }) {
  const { asset, assetId } = useAssetBySlug(slug);
  const metrics = useMetrics(assetId);
  void asset;

  return (
    <div className="asset-facts">
      <div>
        <span>Maturity</span>
        <strong>{formatDate(metrics.data?.data.maturity)}</strong>
      </div>
      <div>
        <span>NAV</span>
        <strong>
          {formatPrice(metrics.data?.data.nav.value ?? null)} mUSD
          {metrics.data?.data.nav.stale === true && <em> (stale)</em>}
        </strong>
      </div>
      <div>
        <span>Offering</span>
        <strong>{metrics.data?.data.offering.open === true ? "Open" : "Closed"}</strong>
      </div>
      <div>
        <span>Raised</span>
        <strong>
          {formatAmount(metrics.data?.data.offering.raised)} /{" "}
          {formatAmount(metrics.data?.data.offering.cap)} mUSD
        </strong>
      </div>
    </div>
  );
}

export function ChangeBadge({ change }: { change: string | null }) {
  if (change === null) return <small>No trades yet</small>;
  return <small className={change.startsWith("-") ? "" : "positive"}>{formatPercent(change)}</small>;
}

/** PositionLiquidity needs the assetId; this resolves it from the route's slug. */
export function PositionLiquidityForSlug({ slug }: { slug: string }) {
  const { assetId } = useAssetBySlug(slug);
  return <PositionLiquidity {...(assetId ? { assetId } : {})} />;
}
