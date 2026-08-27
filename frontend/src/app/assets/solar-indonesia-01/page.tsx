import type { Metadata } from "next";
import Link from "next/link";
import { ActionDeck } from "@/components/action-deck";
import { PositionLiquidity } from "@/components/position-liquidity";
import { PriceChart } from "@/components/price-chart";
import { StatusPill } from "@/components/ui";
import { solarAsset } from "@/lib/data";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FileCheck2,
  Layers3,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  Zap,
} from "lucide-react";

export const metadata: Metadata = { title: "Solar Indonesia 01" };

export default function AssetDetailPage() {
  return (
    <div className="page-container asset-market-page">
      <Link className="back-link" href="/"><ArrowLeft size={14} /> All asset markets</Link>

      <section className="asset-market-header">
        <div className="asset-identity">
          <div className="asset-avatar solar large"><span>SR</span></div>
          <div>
            <div className="asset-title-line"><h1>{solarAsset.name}</h1><StatusPill><CheckCircle2 size={13} /> Verified</StatusPill></div>
            <div className="asset-subline"><strong>{solarAsset.symbol}</strong><span>{solarAsset.category}</span><button type="button">0x7e42…98ac <Copy size={11} /></button></div>
          </div>
        </div>
        <div className="asset-head-price"><span>Market price</span><strong>1.018 <small>mUSD</small></strong><b><TrendingUp size={13} /> +1.8% vs NAV</b></div>
      </section>

      <div className="asset-market-layout">
        <div className="market-main-column">
          <section className="panel chart-panel market-chart-panel">
            <div className="market-chart-heading">
              <div><span className="eyebrow">SOLAR01 / mUSD</span><div className="chart-live-price"><strong>1.018</strong><span>mUSD</span><b>+0.018 (+1.8%)</b></div></div>
              <div className="floor-price-callout"><span><ShieldCheck size={13} /> Protected floor reference</span><strong>0.820 mUSD</strong><small>Reserve-limited, not a peg</small></div>
            </div>
            <PriceChart />
            <div className="chart-disclosure"><ShieldCheck size={14} /><p>The protected floor is a backing-aware reference based on verified NAV and liquid reserve per redeemable token. Redemption remains liquidity-limited.</p></div>
          </section>

          <PositionLiquidity />

          <section className="panel supply-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">CAPPED SERIES</span><h2>Supply structure</h2></div>
              <StatusPill tone="blue"><Layers3 size={13} /> Policy preview</StatusPill>
            </div>
            <div className="supply-summary">
              <div><span>Authorized supply</span><strong>100,000</strong><small>Hard cap for SOLAR01</small></div>
              <div><span>Issued supply</span><strong>58,400</strong><small>Free float + vested allocation</small></div>
              <div><span>Company vesting</span><strong>20,000</strong><small>Locked, gradual release</small></div>
              <div><span>Issuance headroom</span><strong>41,600</strong><small>Unminted inside the cap</small></div>
            </div>
            <div className="supply-track" aria-label="SOLAR01 authorized supply allocation">
              <span className="supply-float" style={{ width: "38.4%" }} />
              <span className="supply-vested" style={{ width: "20%" }} />
              <span className="supply-headroom" style={{ width: "41.6%" }} />
            </div>
            <div className="supply-legend">
              <span className="float">38.4% free float</span>
              <span className="vested">20% company vesting</span>
              <span className="headroom">41.6% issuance headroom</span>
            </div>
            <p className="supply-note">Headroom cannot be minted by the market maker. Future issuance requires verified demand, reserve solvency, and a disclosed allocation.</p>
            <div className="yield-rule">
              <CircleDollarSign size={16} />
              <div><span>Yield-eligible supply</span><strong>38,400 circulating SOLAR01</strong></div>
              <p>Company vesting is excluded until release. Unminted headroom never enters the yield denominator.</p>
            </div>
          </section>

          <section className="panel company-profile-panel">
            <div className="company-profile-head">
              <div className="company-avatar"><Building2 size={20} /><span>{solarAsset.issuer.initials}</span></div>
              <div><span className="eyebrow">DEMO ISSUER PROFILE</span><h2>{solarAsset.issuer.name}</h2><p><MapPin size={11} /> {solarAsset.issuer.jurisdiction}</p></div>
              <StatusPill><BadgeCheck size={13} /> Verified issuer</StatusPill>
            </div>
            <div className="company-profile-body">
              <div className="company-profile-copy">
                <p>{solarAsset.issuer.description}</p>
                <span><FileCheck2 size={13} /> Profile, operating evidence, and disclosures reviewed for this demo asset.</span>
              </div>
              <div className="company-profile-facts">
                <div><span>Sector</span><strong>{solarAsset.issuer.sector}</strong></div>
                <div><span>Portfolio</span><strong>{solarAsset.issuer.portfolio}</strong></div>
                <div><span>Operating capacity</span><strong>{solarAsset.issuer.capacity}</strong></div>
                <div><span>Reporting cycle</span><strong>{solarAsset.issuer.reporting}</strong></div>
              </div>
            </div>
          </section>

          <section className="panel asset-overview-panel">
            <nav className="asset-tabs" aria-label="Asset information"><button className="active" type="button">Overview</button><button type="button">Documents</button><button type="button">Cash flow</button><button type="button">Activity</button></nav>
            <div className="asset-overview-grid">
              <div className="asset-story">
                <span className="eyebrow">UNDERLYING ASSET</span>
                <h2>Distributed solar infrastructure, financed through a verified onchain participation market.</h2>
                <p>{solarAsset.description}</p>
                <div className="asset-tags"><span>Asset participation token</span><span>Indonesia</span><span>Renewable energy</span><span>3-year term</span><span>Monthly revenue</span></div>
              </div>
              <div className="asset-facts">
                <div><span>Verifier</span><strong><BadgeCheck size={13} /> {solarAsset.verifier}</strong></div>
                <div><span>Maturity</span><strong><CalendarDays size={13} /> {solarAsset.maturity}</strong></div>
                <div><span>Revenue source</span><strong><Zap size={13} /> Electricity sales</strong></div>
                <div><span>Metadata</span><strong><FileCheck2 size={13} /> IPFS anchored <ExternalLink size={11} /></strong></div>
              </div>
            </div>
          </section>
        </div>

        <aside className="market-side-column">
          <ActionDeck />
          <section className="panel reserve-floor-card">
            <div className="reserve-card-head"><span><ShieldCheck size={15} /> Protected floor reference</span><StatusPill tone="blue">Backed</StatusPill></div>
            <div className="floor-primary"><span>Current reference</span><strong>0.820 <small>mUSD</small></strong><p>80.6% of the current market price</p></div>
            <div className="reserve-meter"><span style={{ width: "82%" }} /><i /></div>
            <div className="floor-stat-grid">
              <div><span>Stable reserve</span><strong>24,600 mUSD</strong></div>
              <div><span>Reserve ratio</span><strong>24.6%</strong></div>
              <div><span>Minimum ratio</span><strong>20.0%</strong></div>
              <div><span>Reserve buffer</span><strong className="positive">+4.6%</strong></div>
            </div>
            <Link className="reserve-link" href="/engine">How the reference is calculated <ArrowLeft size={13} /></Link>
          </section>
          <section className="panel holdings-card">
            <div className="panel-heading"><h3>Your position</h3><span>Demo</span></div>
            <div><span>Holdings</span><strong>12,500 SOLAR01</strong></div>
            <div><span>Market value</span><strong>12,725 mUSD</strong></div>
            <div><span>Claimable revenue</span><strong className="positive">142.80 mUSD</strong></div>
            <div><span>Floor reference value</span><strong><WalletCards size={14} /> 10,250 mUSD</strong></div>
            <div><span>Maturity</span><strong><CalendarDays size={14} /> {solarAsset.maturity}</strong></div>
          </section>
          <section className="panel utility-card">
            <div className="panel-heading"><h3><LockKeyhole size={14} /> Lock &amp; earn</h3><StatusPill tone="amber">Target model</StatusPill></div>
            <div><span>Reward source</span><strong>Realized revenue + fees</strong></div>
            <div><span>Reward asset</span><strong>mUSD</strong></div>
            <div><span>Free-float guard</span><strong>20% minimum</strong></div>
            <p>No inflationary SOLAR01 rewards. Locking is not enabled in the current MVP contracts.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
