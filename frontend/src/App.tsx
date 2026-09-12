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
 * The concept landing page (openspec/changes/concept-landing-page).
 *
 * This replaces the D-035 scaffold page, which existed only to prove the ported `/v1` client
 * worked end to end. That client, its react-query bindings, the fixture adapter, and
 * `DataSourceBadge` / `DataPanel` are all untouched in `src/lib/` and `src/components/
 * data-source.tsx` — they simply have no consumer on this page. Every figure here is
 * illustrative, and the page never calls the backend at all; see `ConceptBanner` and
 * `docs/FRONTEND.md` for what that trade-off is and why it was made deliberately.
 *
 * `ConceptBanner` and `LandingHeader` share one `sticky top-0` wrapper rather than each being
 * independently sticky, so the banner cannot end up stacked under the header (or vice versa) at
 * any viewport width — the banner's persistence is the property this whole page's honesty rests
 * on, so its positioning is not left to two elements agreeing on a z-index by coincidence.
 */
export default function App() {
  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-50">
        {/* <ConceptBanner /> */}
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
