import type { Metadata } from "next";
import { CircleDollarSign, Droplets, Gauge, Layers3, LockKeyhole, ShieldCheck } from "lucide-react";
import { IssuerForms } from "@/components/operator-forms";
import { Metric, PageIntro, StatusPill } from "@/components/ui";

export const metadata: Metadata = { title: "Issuer workspace" };

export default function IssuerPage() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="ISSUER WORKSPACE" title="Fund an asset, not an unlimited supply." description="Configure a capped asset series, protect the reserve, settle investor subscriptions, and keep company allocation visible through vesting." action={<StatusPill tone="blue"><Layers3 size={13} /> Target policy preview</StatusPill>} />
      <section className="metric-grid four">
        <Metric label="Capital settled" value="38,400 mUSD" detail="64% of investor allocation" icon={CircleDollarSign} />
        <Metric label="Company vesting" value="20,000 SOLAR01" detail="Locked, gradual release" icon={LockKeyhole} />
        <Metric label="Protected reserve" value="24,600 mUSD" detail="Remains protected" icon={Droplets} />
        <Metric label="Issuance headroom" value="41,600 SOLAR01" detail="Unminted inside the cap" icon={Gauge} />
      </section>
      <section className="offering-progress panel">
        <div className="panel-heading">
          <div><span className="eyebrow">SETTLEMENT PREVIEW</span><h2>SOLAR01 partial-success outcome</h2></div>
          <div className="offering-result"><StatusPill tone="amber">Partial success</StatusPill><strong>38,400 / 60,000 mUSD</strong></div>
        </div>
        <div className="progress-shell">
          <div className="progress-track"><span style={{ width: "64%" }} /></div>
          <i className="threshold-marker" aria-hidden="true" />
        </div>
        <div className="progress-labels"><span>50% minimum threshold</span><strong>64% funded</strong><span>100% full target</span></div>
        <div className="settlement-grid">
          <div><span>Investor delivery</span><strong>38,400 SOLAR01</strong><small>Purchased tokens</small></div>
          <div><span>Company allocation</span><strong>20,000 SOLAR01</strong><small>Sent to vesting</small></div>
          <div><span>Unminted headroom</span><strong>41,600 SOLAR01</strong><small>Not company inventory</small></div>
          <div><span>Reserve treatment</span><strong>24,600 mUSD</strong><small>Full balance protected</small></div>
        </div>
        <p className="settlement-note"><ShieldCheck size={14} /> Investor token delivery, company vesting, reserve activation, and issuer-proceeds release settle atomically in the target model.</p>
      </section>
      <p className="disclosure-banner"><strong>MVP boundary:</strong> the controls below still call the current deployed contracts. Escrowed fundraising, threshold settlement, vesting, and governed issuance headroom are UI policy previews until their contracts are implemented.</p>
      <IssuerForms />
    </div>
  );
}
