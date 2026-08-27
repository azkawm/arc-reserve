import type { Metadata } from "next";
import { AlertTriangle, Clock3, FileCheck2, ShieldCheck } from "lucide-react";
import { VerifierActions } from "@/components/operator-forms";
import { Metric, PageIntro, StatusPill } from "@/components/ui";

export const metadata: Metadata = { title: "Verifier workspace" };

export default function VerifierPage() {
  return (
    <div className="page-container">
      <PageIntro eyebrow="VERIFIER WORKSPACE" title="Asset assurance" description="Review asset evidence, publish bounded NAV updates, and protect markets when the underlying record changes." action={<StatusPill tone="blue"><ShieldCheck size={13} /> Verifier role active</StatusPill>} />
      <section className="metric-grid four">
        <Metric label="Pending review" value="1 asset" detail="Solar Indonesia 02" icon={Clock3} />
        <Metric label="Approved" value="1 asset" detail="100,000 mUSD NAV" icon={FileCheck2} />
        <Metric label="Fresh NAV" value="42 min" detail="2-day stale threshold" icon={ShieldCheck} />
        <Metric label="Active alerts" value="0" detail="All gates clear" icon={AlertTriangle} />
      </section>
      <section className="panel review-queue">
        <div className="panel-heading"><div><span className="eyebrow">REVIEW QUEUE</span><h2>Solar Indonesia 02</h2></div><StatusPill tone="amber">Pending</StatusPill></div>
        <div className="review-grid"><div><span>Issuer</span><strong>0x71C…8F2A</strong></div><div><span>Category</span><strong>Renewable energy</strong></div><div><span>Proposed value</span><strong>75,000 mUSD</strong></div><div><span>Maturity</span><strong>Aug 2029</strong></div></div>
        <div className="queue-actions"><button className="secondary-button">Open metadata</button><button className="secondary-button">Reject with reason</button><button className="primary-button">Approve asset</button></div>
      </section>
      <VerifierActions />
    </div>
  );
}

