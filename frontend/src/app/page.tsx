import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  Clock3,
  Droplets,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { FeaturedMarket, MarketList } from "@/components/market-list";
import { ProtocolStats } from "@/components/protocol-stats";

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

        <FeaturedMarket />
      </section>

      <ProtocolStats />

      <MarketList />

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
