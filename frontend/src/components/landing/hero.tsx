import { ArrowDown, ArrowRight, Compass } from "lucide-react";
import { ConceptMarker } from "@/components/landing/concept-marker";
import { ShaderBackground } from "@/components/landing/shader-background";
import { Button } from "@/components/ui/button";

/**
 * The hero. Copy is rewritten from `stitch-ui/arcreserve_institutional_rwa_protocol_landing_page_2`
 * against the concept-landing-page spec's claim rules: the reference's eyebrow tag claims
 * "Production Live on Base" and its supporting line promises "continuous onchain reserve
 * guarantees" — both fail the project's own non-negotiable rules regardless of the concept
 * framing (no "guarantee" language; testnet only, never described as production). The headline
 * itself is the product's real tagline (`docs/PROPOSAL.en.md`) and is kept verbatim.
 */
export function Hero() {
  return (
    <section
      id="hero"
      className="relative flex min-h-[calc(100vh-4rem)] flex-col items-center justify-between overflow-hidden px-4 py-10 sm:px-6"
    >
      <ShaderBackground />

      <div className="relative z-10" />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        {/* <span className="border-mist bg-paper/85 text-charcoal inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-medium tracking-wide uppercase shadow-sm backdrop-blur-md">
          <span className="bg-signal-blue h-2 w-2 rounded-full" aria-hidden="true" />
          ERC-3643 Institutional Protocol • Concept Preview — Base Sepolia
        </span> */}

        <h1 className="text-4xl leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
          Real assets.
          <br />
          <span className="text-cerulean-deep italic">Programmable</span> liquidity.
        </h1>

        <p className="text-charcoal max-w-xl text-base leading-relaxed sm:text-lg">
          Real-world infrastructure cash flows, tokenized with a category-accounted onchain
          reserve and reserve-limited redemption.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button asChild size="lg" className="group">
            <a href="#engine">
              Explore the Concept
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#value-references">
              <Compass size={16} />
              Protocol Architecture
            </a>
          </Button>
        </div>

        <div className="border-mist bg-paper/80 mt-2 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border px-4 py-2 shadow-sm backdrop-blur-md">
          <span className="text-ink text-[11px] font-semibold tracking-wide uppercase">
            SOLAR01
          </span>
          <Stat label="Active Backing" value="104.2%" />
          <Stat label="Sinking Fund" value="342,000 mUSD" />
          <Stat label="Ratchet Floor" value="0.315 mUSD" accent />
          <ConceptMarker />
        </div>
      </div>

      <a
        href="#engine"
        className="text-ash hover:text-cerulean-deep relative z-10 flex flex-col items-center gap-1 text-[11px] font-medium tracking-wide uppercase transition-colors"
      >
        Scroll to inspect mechanics
        <ArrowDown size={16} className="motion-safe:animate-bounce" aria-hidden="true" />
      </a>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="text-ash inline-flex items-center gap-1 text-[11px]">
      {label}: <strong className={accent ? "text-cerulean-deep font-mono" : "text-ink font-mono"}>{value}</strong>
    </span>
  );
}
