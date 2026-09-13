import { ArrowUp, Layers, Scale } from "lucide-react";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Button } from "@/components/ui/button";

/**
 * The closing call to action, adapted from the reference's colophon-adjacent CTA band.
 *
 * Both of the reference's actions point nowhere real: "Access Investor Terminal" links to
 * `#flagship-solar`, a SOLAR01 deep-dive section that does not exist in this change (deferred
 * per design.md), and "Download Institutional Term Sheet (PDF)" links to a bare `#` with no PDF
 * behind it. Rather than repeat that pattern with a different fake destination, both CTAs here
 * resolve to sections that actually exist on this page — the same discipline
 * `DualParticipantEngine` applied to its own two dead links.
 *
 * The trust line drops two things: "Dual Audit by Halborn & VeriSol" (the banned audit claim),
 * and "Restricted to accredited participants" — which is not just aspirational overclaiming but
 * a factual error, since the real identity registry has three investor classes including retail
 * (D-028), each with its own purchase cap. Restating that accurately is more interesting than
 * the reference's exclusionary framing, not less.
 */
export function ClosingCta() {
  return (
    <section className="border-mist bg-linen border-t px-4 py-16 sm:px-6" id="closing-cta">
      <ScrollReveal>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <span className="border-mist bg-paper text-charcoal inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] shadow-sm">
            <span className="bg-signal-blue h-2 w-2 rounded-full" aria-hidden="true" />
            Concept onboarding — illustrative wave 03
          </span>

          <h2 className="text-ink text-3xl font-normal">
            A concept for institution-grade cash flow tokenization.
          </h2>

          <p className="text-charcoal max-w-xl text-sm leading-relaxed">
            Explore illustrative physical energy cash flows on a testnet. Review how the value
            references hold apart, how the safety ladder escalates, and how programmatic reserve
            backing would work.
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="#value-references">
                <Layers size={16} />
                Review the Value References
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#hero">
                <ArrowUp size={16} />
                Back to Top
              </a>
            </Button>
          </div>

          <div className="border-mist text-ash mt-4 flex w-full max-w-md items-center justify-center gap-2 border-t pt-4 text-[11px]">
            <Scale size={13} aria-hidden="true" />
            <span>Retail, accredited, and institutional classes — each with its own cap.</span>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
