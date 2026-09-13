import { ClosingCta } from "@/components/landing/closing-cta";
import { ConceptBanner } from "@/components/landing/concept-banner";
import { DualParticipantEngine } from "@/components/landing/dual-participant-engine";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { SafetyLadder } from "@/components/landing/safety-ladder";
import { TelemetryBand } from "@/components/landing/telemetry-band";
import { ValueReferences } from "@/components/landing/value-references";

/**
 * The concept landing page (openspec/changes/concept-landing-page), moved out of `App` when the
 * portal router landed. The page is unchanged: it reads no live data and is explicitly a design
 * concept, with a persistent, non-dismissible label and a per-panel concept marker.
 *
 * `ConceptBanner` and `LandingHeader` share one `sticky top-0` wrapper rather than each being
 * independently sticky, so the banner cannot end up stacked under the header (or vice versa) at
 * any viewport width — the banner's persistence is the property this page's honesty rests on.
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50">
        <ConceptBanner />
        <LandingHeader />
      </div>

      <main>
        <Hero />
        <TelemetryBand />
        <DualParticipantEngine />
        <ValueReferences />
        <SafetyLadder />
        <ClosingCta />
      </main>

      <LandingFooter />
    </div>
  );
}
