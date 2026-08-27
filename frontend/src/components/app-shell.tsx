import Link from "next/link";
import { Activity, BarChart3, Building2, LayoutGrid, ShieldCheck, Sparkles, SunMedium } from "lucide-react";
import { WalletButton } from "./wallet-button";

const navigation = [
  { href: "/", label: "Markets", icon: LayoutGrid },
  { href: "/assets/solar-indonesia-01", label: "Activity", icon: Activity },
  { href: "/engine", label: "ARC Engine", icon: BarChart3 },
  { href: "/verifier", label: "Verify", icon: ShieldCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="ArcReserve home">
          <span className="brand-mark"><SunMedium size={18} /></span>
          <span><strong>ARC</strong>RESERVE</span>
        </Link>
        <nav className="top-nav" aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link href={href} key={href}><Icon size={17} />{label}</Link>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="network-badge"><span className="network-pulse" /> Anvil 31337</span>
          <Link href="/issuer" className="launch-button"><Building2 size={15} /><span>Tokenize asset</span><Sparkles size={13} /></Link>
          <WalletButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
