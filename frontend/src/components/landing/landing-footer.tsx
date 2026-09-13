import { ExternalLink } from "lucide-react";
import { ArcMonogram } from "@/components/landing/arc-monogram";

/**
 * The page's closing disclaimer, restated at the structural bottom of the page as
 * defense-in-depth alongside the persistent top banner (`ConceptBanner`). Copy here is the same
 * accurate, product-approved disclaimer the previous scaffold page used — not the Stitch
 * reference's colophon, which asserts a "Sinking Fund Health Ratio" and an audit-governed
 * regulatory framework this protocol does not have.
 */
export function LandingFooter() {
  return (
    <footer className="border-mist border-t">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-md">
            <ArcMonogram className="h-6 w-auto" />
            <p className="text-ash mt-3 text-xs leading-relaxed">
              A SOLAR01 token is a capped participation claim. It is not equity, not legal title,
              not a guaranteed return, and not a price peg. No audit has been performed. No real
              funds move on any target chain.
            </p>
          </div>
          <div className="text-ash flex flex-col gap-2 text-xs">
            <span>ArcReserve — hackathon submission, testnet only.</span>
            <a
              className="hover:text-cerulean-deep inline-flex items-center gap-1.5 transition-colors"
              href="https://github.com"
              rel="noreferrer noopener"
              target="_blank"
            >
              Source <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
