import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  Clock3,
  Droplets,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { StatusPill } from "@/components/ui";
import { marketPipeline } from "@/lib/data";

export default function MarketplacePage() {
  return (
    <div className="page-container marketplace-page">
      <section className="launch-hero">
        <div className="launch-hero-copy">
          <span className="hero-chip"><Sparkles size={13} /> Verified assets, capped markets</span>
          <h1>Launch and trade <span>verified assets.</span></h1>
          <p>
            Fund verified assets through capped participation tokens, transparent reserves, and
            staged liquidity designed to keep each market active beyond its first raise.
          </p>
          <div className="hero-actions">
            <Link className="primary-button hero-button" href="/issuer"><Building2 size={16} /> Tokenize an asset</Link>
            <Link className="text-button" href="#markets">Explore markets <ArrowRight size={15} /></Link>
          </div>
          <div className="hero-proof">
            <span><BadgeCheck size={14} /> Capped asset series</span>
            <span><ShieldCheck size={14} /> Reserve protected</span>
            <span><CircleDollarSign size={14} /> Revenue onchain</span>
          </div>
        </div>

        <Link href="/assets/solar-indonesia-01" className="hero-market-card">
          <div className="hero-card-top">
            <div className="asset-avatar solar"><span>SR</span></div>
            <div><span className="eyebrow">FEATURED MARKET</span><h2>Solar Indonesia 01</h2><p>SOLAR01 · Renewable energy</p></div>
            <StatusPill><span className="status-dot" /> Live</StatusPill>
          </div>
          <div className="hero-price-row">
            <div><span>Market price</span><strong>1.018 <small>mUSD</small></strong><b>+1.8%</b></div>
            <div><span>Protected floor reference</span><strong>0.820 <small>mUSD</small></strong><p>Reserve-backed, not a peg</p></div>
          </div>
          <div className="floor-track" aria-label="Market price compared with protected floor">
            <span className="floor-fill" />
            <i className="floor-marker">Floor</i>
            <i className="spot-marker">Spot</i>
          </div>
          <div className="hero-card-bottom">
            <span><Droplets size={14} /> 24,600 mUSD reserve</span>
            <span><TrendingUp size={14} /> 8,420 mUSD realized revenue</span>
            <strong>Open market <ArrowRight size={14} /></strong>
          </div>
        </Link>
      </section>

      <section className="market-stats" aria-label="Protocol statistics">
        <div><span>Total asset value</span><strong>100,000 mUSD</strong><small>Verified NAV</small></div>
        <div><span>Protected reserves</span><strong>24,600 mUSD</strong><small>Ring-fenced liquidity</small></div>
        <div><span>Issuance headroom</span><strong>41,600 SOLAR01</strong><small>Inside the authorized cap</small></div>
        <div><span>Assets in pipeline</span><strong>03</strong><small>Across three categories</small></div>
      </section>

      <section className="market-section" id="markets">
        <div className="market-section-head">
          <div><span className="eyebrow">DISCOVER</span><h2>Asset markets</h2><p>Track every asset from verification through live price discovery.</p></div>
          <label className="search-field"><Search size={16} /><input placeholder="Search name, symbol, category" aria-label="Search assets" /></label>
        </div>
        <div className="market-filter-row" aria-label="Market filters">
          <button className="active" type="button">All assets <span>3</span></button>
          <button type="button">Live <span>1</span></button>
          <button type="button">Opening soon <span>1</span></button>
          <button type="button">In review <span>1</span></button>
        </div>

        <div className="market-list">
          <div className="market-list-header">
            <span>Asset</span><span>Market price</span><span>Floor reference</span><span>Reserve</span><span>Status</span><span />
          </div>
          {marketPipeline.map((asset) => {
            const content = (
              <>
                <div className="market-asset-name">
                  <div className={`asset-avatar ${asset.accent}`}><span>{asset.symbol.slice(0, 2)}</span></div>
                  <div><strong>{asset.name}</strong><span>{asset.symbol} · {asset.category}</span></div>
                </div>
                <div className="market-cell"><span>Market price</span><strong>{asset.price}</strong><small className={asset.status === "Live" ? "positive" : ""}>{asset.change}</small></div>
                <div className="market-cell"><span>Floor reference</span><strong>{asset.floor}</strong><small>Reserve-limited</small></div>
                <div className="market-cell"><span>Reserve</span><strong>{asset.reserve}</strong><small>Ring-fenced</small></div>
                <div className="market-status"><StatusPill tone={asset.status === "Live" ? "green" : "amber"}>{asset.status}</StatusPill></div>
                <ArrowRight className="market-arrow" size={17} />
              </>
            );
            return asset.href ? <Link className="market-row" href={asset.href} key={asset.symbol}>{content}</Link> : <div className="market-row muted-row" key={asset.symbol}>{content}</div>;
          })}
        </div>
      </section>

      <section className="journey-section">
        <div className="journey-copy"><span className="eyebrow">BUILT FOR REAL ASSETS</span><h2>Simple to enter.<br />Hard to fake.</h2><p>The launchpad experience stays fast while the asset lifecycle remains explicit.</p></div>
        <div className="journey-steps">
          <div><span>01</span><BadgeCheck size={20} /><h3>Verify</h3><p>Anchor documents, valuation, maturity, and verifier approval.</p></div>
          <div><span>02</span><Droplets size={20} /><h3>Reserve</h3><p>Deposit protected backing before investor subscriptions open.</p></div>
          <div><span>03</span><TrendingUp size={20} /><h3>Fundraise</h3><p>Raise in escrow against a disclosed, capped token allocation.</p></div>
          <div><span>04</span><Clock3 size={20} /><h3>Settle &amp; trade</h3><p>Deliver tokens atomically, vest company supply, then open price discovery.</p></div>
        </div>
      </section>
    </div>
  );
}
