import type { Metadata } from "next";
import { Activity, Clock3, Droplets, Gauge, ShieldCheck } from "lucide-react";
import { EngineChart } from "@/components/engine-chart";
import { EngineControls } from "@/components/engine-controls";
import { PositionLiquidity } from "@/components/position-liquidity";
import { Metric, PageIntro, StatusPill } from "@/components/ui";
import { rebalances } from "@/lib/data";

export const metadata: Metadata = { title: "ARC Liquidity Engine" };

export default function EnginePage() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="ASSET-RESERVE CURVE" title="ARC Liquidity Engine" description="Concentrated market liquidity that follows eligible price discovery without spending the protected redemption reserve or receiving mint authority." action={<StatusPill><ShieldCheck size={13} /> All safety gates clear</StatusPill>} />
      <section className="metric-grid four">
        <Metric label="Market spot" value="1.018 mUSD" detail="+1.8% vs NAV" icon={Activity} />
        <Metric label="30m TWAP" value="1.006 mUSD" detail="1.2% spot deviation" icon={Clock3} />
        <Metric label="Verified NAV" value="1.000 mUSD" detail="Fresh · 42 min" icon={Gauge} />
        <Metric label="Protected floor ref." value="0.820 mUSD" detail="24.6% reserve ratio" icon={Droplets} />
      </section>
      <section className="panel engine-panel">
        <div className="panel-heading"><div><span className="eyebrow">CONCENTRATED LIQUIDITY MAP</span><h2>SOLAR01 / mUSD</h2></div><div className="legend"><span className="floor">Market floor range</span><span className="anchor">Anchor</span><span className="discovery">Discovery</span></div></div>
        <EngineChart />
        <PositionLiquidity embedded />
        <EngineControls />
      </section>
      <div className="engine-lower-grid">
        <section className="panel safety-panel">
          <div className="panel-heading"><div><span className="eyebrow">EXECUTION POLICY</span><h2>Safety gates</h2></div><StatusPill>Eligible</StatusPill></div>
          <ul className="safety-list"><li><ShieldCheck size={15} /><span>NAV freshness</span><strong>42m / 48h</strong></li><li><ShieldCheck size={15} /><span>Spot / TWAP</span><strong>1.2% / 3.0%</strong></li><li><ShieldCheck size={15} /><span>Market / NAV</span><strong>0.6% / 20.0%</strong></li><li><ShieldCheck size={15} /><span>Reserve solvency</span><strong>24.6% / 20.0%</strong></li><li><ShieldCheck size={15} /><span>Cooldown</span><strong>Elapsed</strong></li></ul>
        </section>
        <section className="panel history-panel">
          <div className="panel-heading"><div><span className="eyebrow">KEEPER LOG</span><h2>Rebalancing history</h2></div></div>
          <div className="history-list">{rebalances.map((item) => <div key={item.time + item.action}><time>{item.time}</time><span><strong>{item.action}</strong><small>{item.reason}</small></span><b>{item.shift}</b></div>)}</div>
        </section>
      </div>
      <p className="disclosure-banner"><strong>Safety disclosure:</strong> The market floor range shown above is a liquidity position, not the protected floor reference. Market price, TWAP, verified NAV, and reserve-limited redemption remain separate values. None is a guaranteed return or legal ownership claim.</p>
    </div>
  );
}
