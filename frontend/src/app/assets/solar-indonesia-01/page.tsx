import type { Metadata } from "next";
import Link from "next/link";
import { ActionDeck } from "@/components/action-deck";
import { StatusPill } from "@/components/ui";
import {
  AssetChartPanel,
  AssetFacts,
  AssetHero,
  FloorCard,
  HoldingsCard,
  PositionLiquidityForSlug,
  SupplyStructure,
} from "@/components/asset-panels";
import { solarAsset } from "@/lib/data";
import { ArrowLeft, BadgeCheck, Building2, FileCheck2, LockKeyhole, MapPin } from "lucide-react";

const SLUG = "solar-indonesia-01";


export const metadata: Metadata = { title: "Solar Indonesia 01" };

export default function AssetDetailPage() {
  return (
    <div className="page-container asset-market-page">
      <Link className="back-link" href="/"><ArrowLeft size={14} /> All asset markets</Link>

      <AssetHero slug={SLUG} />

      <div className="asset-market-layout">
        <div className="market-main-column">
          <AssetChartPanel slug={SLUG} />

          <PositionLiquidityForSlug slug={SLUG} />

          <SupplyStructure slug={SLUG} />

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
              <AssetFacts slug={SLUG} />
            </div>
          </section>
        </div>

        <aside className="market-side-column">
          <ActionDeck />
          <FloorCard slug={SLUG} />
          <HoldingsCard slug={SLUG} />
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
