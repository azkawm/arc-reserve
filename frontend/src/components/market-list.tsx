"use client";

import Link from "next/link";
import { ArrowRight, Droplets, Search, TrendingUp } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/ui";
import { DataPanel, DataSourceBadge } from "@/components/data-source";
import { useAssets } from "@/lib/queries";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import type { AssetListItem, AssetStatus } from "@/lib/api";

/**
 * The marketplace list and the featured card, both from `/v1/assets`.
 *
 * Every number that used to be a pre-formatted string in `data.ts` ("1.018 mUSD", "24.6k
 * mUSD", "+1.8%") is now a decimal string from the API that this component formats. The
 * accent colour and the link are the only things still derived locally, because they are
 * presentation, not data.
 */

const ACCENT: Record<string, string> = {
  "Renewable energy": "solar",
  "Private credit": "credit",
  "Carbon credits": "carbon",
};

const FILTERS: Array<{ label: string; status?: AssetStatus }> = [
  { label: "All assets" },
  { label: "Live", status: "Active" },
  { label: "Opening soon", status: "Approved" },
  { label: "In review", status: "Pending" },
];

function accentFor(category: string): string {
  return ACCENT[category] ?? "solar";
}

function statusTone(status: AssetStatus): "green" | "amber" {
  return status === "Active" ? "green" : "amber";
}

export function FeaturedMarket() {
  const assets = useAssets();
  const featured = assets.data?.data.find((asset) => asset.status === "Active") ?? assets.data?.data[0];

  return (
    <div className="hero-market-card-wrap">
      <DataPanel query={assets} loadingLabel="Loading featured market">
        {(_data, meta) => {
          if (featured === undefined) {
            return <div className="panel-state empty"><span>No assets indexed yet.</span></div>;
          }

          return (
            <Link href={`/assets/${featured.slug}`} className="hero-market-card">
              <div className="hero-card-top">
                <div className={`asset-avatar ${accentFor(featured.category)}`}>
                  <span>{featured.symbol.slice(0, 2)}</span>
                </div>
                <div>
                  <span className="eyebrow">FEATURED MARKET</span>
                  <h2>{featured.name}</h2>
                  <p>
                    {featured.symbol} · {featured.category}
                  </p>
                </div>
                <StatusPill tone={statusTone(featured.status)}>
                  <span className="status-dot" /> {featured.status}
                </StatusPill>
              </div>

              <div className="hero-price-row">
                <div>
                  <span>
                    Market price <DataSourceBadge meta={meta} {...(featured.spot ? { provenance: featured.spot.provenance } : {})} />
                  </span>
                  <strong>
                    {formatPrice(featured.spot?.value ?? null)} <small>mUSD</small>
                  </strong>
                  {featured.change24h !== null && <b>{formatPercent(featured.change24h)}</b>}
                </div>
                <div>
                  <span>Protected floor reference</span>
                  <strong>
                    {formatPrice(featured.floor)} <small>mUSD</small>
                  </strong>
                  <p>Reserve-backed, not a peg</p>
                </div>
              </div>

              <div className="hero-card-bottom">
                <span>
                  <Droplets size={14} /> {formatCompact(featured.reserve)} mUSD reserve
                </span>
                <span>
                  <TrendingUp size={14} /> Floor {formatPrice(featured.floor)} mUSD
                </span>
                <strong>
                  Open market <ArrowRight size={14} />
                </strong>
              </div>
            </Link>
          );
        }}
      </DataPanel>
    </div>
  );
}

export function MarketList() {
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");
  const assets = useAssets();

  const selected = FILTERS[filter];
  const all = assets.data?.data ?? [];

  const visible = all
    .filter((asset) => selected?.status === undefined || asset.status === selected.status)
    .filter((asset) => {
      if (search.trim() === "") return true;
      const needle = search.toLowerCase();
      return (
        asset.name.toLowerCase().includes(needle) ||
        asset.symbol.toLowerCase().includes(needle) ||
        asset.category.toLowerCase().includes(needle)
      );
    });

  const countFor = (status?: AssetStatus): number =>
    status === undefined ? all.length : all.filter((asset) => asset.status === status).length;

  return (
    <section className="market-section" id="markets">
      <div className="market-section-head">
        <div>
          <span className="eyebrow">DISCOVER</span>
          <h2>Asset markets</h2>
          <p>Track every asset from verification through live price discovery.</p>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="Search name, symbol, category"
            aria-label="Search assets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="market-filter-row" aria-label="Market filters">
        {FILTERS.map((entry, index) => (
          <button
            className={filter === index ? "active" : ""}
            key={entry.label}
            onClick={() => setFilter(index)}
            type="button"
          >
            {entry.label} <span>{countFor(entry.status)}</span>
          </button>
        ))}
        {assets.data && <DataSourceBadge meta={assets.data.meta} className="market-filter-badge" />}
      </div>

      <DataPanel query={assets} loadingLabel="Loading markets">
        {() => (
          <div className="market-list">
            <div className="market-list-header">
              <span>Asset</span>
              <span>Market price</span>
              <span>Floor reference</span>
              <span>Reserve</span>
              <span>Status</span>
              <span />
            </div>
            {visible.length === 0 ? (
              <div className="panel-state empty">
                <span>No assets match this filter.</span>
              </div>
            ) : (
              visible.map((asset) => <MarketRow asset={asset} key={asset.assetId} />)
            )}
          </div>
        )}
      </DataPanel>
    </section>
  );
}

function MarketRow({ asset }: { asset: AssetListItem }) {
  const content = (
    <>
      <div className="market-asset-name">
        <div className={`asset-avatar ${accentFor(asset.category)}`}>
          <span>{asset.symbol.slice(0, 2)}</span>
        </div>
        <div>
          <strong>{asset.name}</strong>
          <span>
            {asset.symbol} · {asset.category}
          </span>
        </div>
      </div>
      <div className="market-cell">
        <span>Market price</span>
        <strong>{asset.spot === null ? "—" : `${formatPrice(asset.spot.value)} mUSD`}</strong>
        <small className={asset.change24h?.startsWith("-") === false ? "positive" : ""}>
          {asset.change24h === null ? "No trades yet" : formatPercent(asset.change24h)}
        </small>
      </div>
      <div className="market-cell">
        <span>Floor reference</span>
        <strong>{asset.floor === null ? "—" : `${formatPrice(asset.floor)} mUSD`}</strong>
        <small>Reserve-limited</small>
      </div>
      <div className="market-cell">
        <span>Reserve</span>
        <strong>{asset.reserve === null ? "—" : `${formatCompact(asset.reserve)} mUSD`}</strong>
        <small>Ring-fenced</small>
      </div>
      <div className="market-status">
        <StatusPill tone={statusTone(asset.status)}>{asset.status}</StatusPill>
      </div>
      <ArrowRight className="market-arrow" size={17} />
    </>
  );

  // Only a deployed, tradeable asset gets a link; a pending one has no page to open.
  return asset.status === "Active" || asset.contracts !== null ? (
    <Link className="market-row" href={`/assets/${asset.slug}`} key={asset.assetId}>
      {content}
    </Link>
  ) : (
    <div className="market-row muted-row" key={asset.assetId}>
      {content}
    </div>
  );
}
