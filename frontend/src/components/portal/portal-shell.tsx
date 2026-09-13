import { ArrowLeftRight, Menu, X } from "lucide-react";
import { useId, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ArcMonogram } from "@/components/landing/arc-monogram";
import { ChainSwitch } from "@/components/portal/chain-switch";
import { FaucetButton } from "@/components/portal/faucet-button";
import { ServiceStatus } from "@/components/portal/service-status";
import { WalletButton } from "@/components/portal/wallet-button";
import { useAssets } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface PortalNavItem {
  to: string;
  label: string;
  end?: boolean;
}

/**
 * The portal layout: top navigation, the chain switch, and the wallet control, wrapping the
 * routed screens. The chain switch lives here rather than on a page because it governs every
 * request the portal makes, not just one screen.
 *
 * The "Trade" destination is the primary active asset's desk (which holds the swap and redeem
 * panels). Its slug is resolved from `/v1/assets` for the active chain rather than hardcoded, so
 * the button follows the chain/asset in view.
 *
 * Below the desktop breakpoint the horizontal nav is replaced by a disclosure button (the same
 * pattern as `landing-header.tsx`), and the header wraps rather than overflowing when the chain
 * switch, faucet and wallet are all present on a phone.
 */
export function PortalShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavId = useId();

  const assets = useAssets();
  const primarySlug = assets.data?.data.find((asset) => asset.status === "Active")?.slug;

  const navItems: PortalNavItem[] = [
    { to: "/", label: "Home", end: true },
    { to: "/offerings", label: "Offerings" },
    { to: "/faucet", label: "Faucet" },
    ...(primarySlug === undefined ? [] : [{ to: `/assets/${primarySlug}`, label: "Trade" }]),
  ];

  return (
    <div className="bg-parchment text-ink flex min-h-dvh flex-col">
      <header className="border-mist bg-parchment/85 sticky top-0 z-50 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-4">
            <NavLink to="/" aria-label="ArcReserve home">
              <ArcMonogram className="h-7 w-auto" />
            </NavLink>
            <nav aria-label="Portal" className="hidden items-center gap-1 lg:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      isActive ? "bg-linen text-ink font-medium" : "text-charcoal hover:text-ink",
                    )
                  }
                >
                  {item.label === "Trade" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowLeftRight size={14} aria-hidden="true" />
                      Trade
                    </span>
                  ) : (
                    item.label
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <FaucetButton />
            <ChainSwitch />
            <WalletButton />
            <button
              type="button"
              className="text-ink hover:bg-linen rounded-md p-2 lg:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls={mobileNavId}
              aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <nav
            id={mobileNavId}
            aria-label="Portal navigation (mobile)"
            className="border-mist flex flex-col gap-1 border-t px-4 py-3 lg:hidden"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "bg-linen text-ink" : "text-charcoal hover:text-ink hover:bg-linen",
                  )
                }
                onClick={() => setMobileNavOpen(false)}
              >
                {item.label === "Trade" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ArrowLeftRight size={14} aria-hidden="true" />
                    Trade
                  </span>
                ) : (
                  item.label
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6">
        <ServiceStatus />
        <Outlet />
      </main>

      <footer className="border-mist text-ash border-t px-4 py-6 text-center text-xs">
        ArcReserve — hackathon submission, testnet only
      </footer>
    </div>
  );
}
