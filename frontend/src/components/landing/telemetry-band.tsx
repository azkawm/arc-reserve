import { PieChart, Shield, SolarPanel, TrendingUp } from "lucide-react";
import { ConceptMarker } from "@/components/landing/concept-marker";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Four illustrative metric cards, adapted from the reference's telemetry band.
 *
 * The reference heading reads "Live Institutional Telemetry & Sovereign Attestations" with a
 * pulsing dot and "Dual Halborn & VeriSol Audited" underneath — both fail the concept-landing-page
 * spec outright ("no panel claims to be live", "no named audit firm"), so the heading, the pulse,
 * and the audit line are all gone rather than reworded. Each card also carries its own
 * `ConceptMarker`, not just the section as a whole — task 3.2's own bar, stricter than the spec's
 * minimum of one marker per panel.
 *
 * Card 3 additionally drops "Fixed Contractual Split": the real split shifts between 60/25/10/5
 * and 40/45/10/5 depending on reserve health (D-023), so calling it fixed is a factual error, not
 * just an aspirational one — this would be wrong even without the concept framing.
 */
export function TelemetryBand() {
  return (
    <section className="border-mist bg-linen/60 border-y px-4 py-10 sm:px-6" id="telemetry">
      <div className="mx-auto max-w-6xl">
        <div className="border-mist mb-6 flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-ink text-xs font-semibold tracking-wider uppercase">
              Illustrative Protocol Telemetry
            </span>
            <span className="text-fog">/</span>
            <span className="text-ash font-mono text-xs">SOLAR01 concept series</span>
          </div>
          <p className="text-ash text-xs">
            Concept figures — not read from an oracle, and not reviewed by any external party.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<Shield size={16} className="text-signal-blue" aria-hidden="true" />}
            label="Active Backing Ratio"
            value="104.2%"
            trend="↑ +4.2% over-collateralized"
            footLabel="Sinking fund"
            footValue="0.342 / 0.320 target mUSD"
          />
          <MetricCard
            icon={<SolarPanel size={16} className="text-ash" aria-hidden="true" />}
            label="24h Revenue Inflows"
            value="18,450 mUSD"
            trend="Grid delivery: 48.2 MWh"
            footLabel="Distribution"
            footValue="Per revenue deposit"
          />
          <MetricCard
            icon={<PieChart size={16} className="text-ash" aria-hidden="true" />}
            label="Investor Gross Payout"
            value="60.0%"
            trend="Schedule-linked, not fixed"
            footLabel="Settlement cadence"
            footValue="Per revenue deposit"
          />
          <MetricCard
            icon={<TrendingUp size={16} className="text-signal-blue" aria-hidden="true" />}
            label="Floor Ratchet Level"
            value="0.315 mUSD / token"
            valueAccent
            trend="Downside risk barrier"
            footLabel="Direction"
            footValue="Monotonic — never decrements"
          />
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueAccent,
  trend,
  footLabel,
  footValue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueAccent?: boolean;
  trend: string;
  footLabel: string;
  footValue: string;
}) {
  return (
    <Card className="hover:border-signal-blue gap-3 py-4 transition-colors">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between">
          <span className="text-ash text-[10px] font-semibold tracking-wide uppercase">
            {label}
          </span>
          {icon}
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={
              valueAccent ? "text-cerulean-deep text-xl font-medium" : "text-ink text-xl font-medium"
            }
          >
            {value}
          </span>
        </div>
        <span className="text-ash text-[11px]">{trend}</span>
        <div className="border-mist text-charcoal flex justify-between border-t pt-2 text-[11px]">
          <span>{footLabel}</span>
          <span className="text-ink font-mono">{footValue}</span>
        </div>
        <ConceptMarker className="mt-1 self-start" />
      </CardContent>
    </Card>
  );
}
