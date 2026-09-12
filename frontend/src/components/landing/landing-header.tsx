import { Menu, X } from "lucide-react";
import { useId, useState } from "react";
import { ArcMonogram } from "@/components/landing/arc-monogram";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { href: "#hero", label: "Overview" },
  { href: "#engine", label: "Dual Engine" },
  { href: "#value-references", label: "Value References" },
  { href: "#safety-ladder", label: "Safety Ladder" },
] as const;

/**
 * The page header. Navigation resolves to in-page anchors, never routes — there is nothing to
 * route to yet (AGENT_FRONTEND.md's standing "no router until the panels exist" holds), and the
 * concept-landing-page spec requires "the corresponding section is scrolled into view and the
 * page does not navigate away".
 *
 * Below the desktop breakpoint the horizontal nav is replaced by a disclosure button rather than
 * a modal or portal-based sheet: no new shadcn primitive, no focus-trap to get right for a menu
 * with four links, and it is trivially verifiable in both Vitest (jsdom renders it, no
 * positioning math involved) and Playwright ("reachable equivalent" is just "not hidden").
 */
export function LandingHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavId = useId();

  return (
    <header className="border-mist bg-parchment/95 border-b backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#hero" className="flex items-center gap-2.5">
          <ArcMonogram className="h-6 w-auto" />
        </a>

        <nav aria-label="Section navigation" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-charcoal hover:text-ink hover:bg-linen rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-ash hidden sm:inline-flex">
            Testnet demo
          </Badge>
          <button
            type="button"
            className="text-ink hover:bg-linen rounded-md p-2 lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls={mobileNavId}
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? (
              <X size={20} aria-hidden="true" />
            ) : (
              <Menu size={20} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileNavOpen && (
        <nav
          id={mobileNavId}
          aria-label="Section navigation (mobile)"
          className="border-mist flex flex-col gap-1 border-t px-4 py-3 lg:hidden"
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-charcoal hover:text-ink hover:bg-linen rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
              onClick={() => setMobileNavOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
