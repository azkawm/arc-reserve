import type { LucideIcon } from "lucide-react";

export function StatusPill({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "amber" | "blue" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail?: string; icon?: LucideIcon }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{Icon && <Icon size={15} />}{label}</div>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <section className="page-intro">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </section>
  );
}

