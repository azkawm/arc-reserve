import { ConceptMarker } from "@/components/landing/concept-marker";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TIERS = [
  {
    tier: "Tier 1",
    label: "Market Spot",
    source: "Uniswap V3 Concentrated Pool",
    value: "1.04",
    cadence: "Per block",
    note: "Volatile secondary liquidity. Free floating.",
    protection: "Immediate secondary liquidity for active traders.",
    accent: false,
  },
  {
    tier: "Tier 2",
    label: "30-Minute TWAP",
    source: "Onchain Time-Weighted Geometric Mean",
    value: "1.02",
    cadence: "Rolling 30 min",
    note: "Shields protocol contracts from flash-loan manipulation.",
    protection: "Shields protocol contracts against flash-loan manipulation.",
    accent: false,
  },
  {
    tier: "Tier 3",
    label: "Verified NAV",
    source: "Independent physical appraisal, published by the verifier role",
    value: "1.00",
    cadence: "Published periodically",
    note: "Reflects appraised plant capacity, not market sentiment.",
    protection: "Anchors accounting valuation to physical asset condition.",
    accent: false,
  },
  {
    tier: "Tier 4",
    label: "Published Floor",
    source: "Ratchet-only mathematical barrier",
    value: "0.315",
    cadence: "Monotonic (floor-only)",
    note: "Hard stop: the floor never decrements onchain.",
    protection: "Irreversible hard bottom; never moves downward.",
    accent: true,
  },
  {
    tier: "Tier 5",
    label: "Redemption Price",
    source: "min(NAV, reserve ÷ investor supply)",
    value: "0.342",
    cadence: "Per redemption request",
    note: "Burn-and-redeem against the reserve, subject to a period limit.",
    protection: "Reserve-backed exit right, rate-limited per period.",
    accent: false,
  },
] as const;

/**
 * The five references this system deliberately keeps distinct — the one section of the page
 * that describes something the deployed protocol genuinely implements (`CLAUDE.md` rule 4).
 *
 * The reference's fifth tier is "Instant Redemption" with a "Real-Time Continuous" cadence and
 * "Instant burn-and-withdraw right" — this is renamed to "Redemption Price" throughout. Rule 5
 * is explicit that redemption is reserve-limited, not an always-on instant promise, so "instant"
 * here would be wrong even setting the concept framing aside. The NAV tier drops "Bureau
 * Veritas": the spec's "no named audit or third-party attestation firm" requirement is not
 * limited to the two names in its own scenario list. The closing invariant callout is renamed
 * from "Invariant Guarantee" to "Structural Invariant" for the same reason the word is banned
 * everywhere else on this page.
 */
export function ValueReferences() {
  return (
    <section className="border-mist border-t px-4 py-14 sm:px-6" id="value-references">
      <div className="mx-auto max-w-6xl">
        <div className="border-mist mb-2 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-ash text-xs font-semibold tracking-widest uppercase">
              Risk Governance
            </span>
            <h2 className="text-ink mt-1 text-3xl">Five Independent Value References</h2>
          </div>
          <p className="text-charcoal max-w-md text-sm">
            Market trading, verified asset value, and the onchain reserve stay separate
            references here — never collapsed into one number.
          </p>
        </div>

        <div className="mb-6 flex justify-end">
          <ConceptMarker />
        </div>

        <ScrollReveal>
          <Card className="border-mist bg-linen mb-8 gap-4 py-5">
            <CardContent className="px-5">
              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-[760px] grid-cols-5 gap-3">
                  {TIERS.map((tier) => (
                    <div
                      key={tier.tier}
                      className={
                        tier.accent
                          ? "border-cerulean bg-paper flex flex-col gap-2 rounded-xl border-2 p-3 shadow-md"
                          : "border-mist bg-paper flex flex-col gap-2 rounded-xl border p-3 shadow-sm"
                      }
                    >
                      <span className="bg-linen text-ash w-fit rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase">
                        {tier.tier}
                      </span>
                      <div>
                        <div
                          className={
                            tier.accent
                              ? "text-cerulean-deep text-sm font-medium"
                              : "text-ink text-sm font-medium"
                          }
                        >
                          {tier.label}
                        </div>
                        <div className="text-ash text-[11px]">{tier.source}</div>
                      </div>
                      <div
                        className={
                          tier.accent
                            ? "text-cerulean-deep font-mono text-base font-semibold"
                            : "text-ink font-mono text-base font-semibold"
                        }
                      >
                        {tier.value} <span className="text-ash text-xs font-normal">mUSD</span>
                      </div>
                      <div className="bg-linen border-mist rounded border p-1.5 text-[10px] leading-tight text-charcoal">
                        {tier.note}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-mist bg-paper mt-4 flex flex-col gap-2 rounded-xl border p-3">
                <div className="text-ash flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    <strong className="text-ink">Structural invariant:</strong>{" "}
                    <code className="bg-linen border-mist rounded border px-1 font-mono">
                      Redemption Price (0.342) ≥ Published Floor (0.315)
                    </code>
                  </span>
                  <span className="text-cerulean-deep font-mono font-medium">
                    Buffer: +0.027 mUSD (+8.6%)
                  </span>
                </div>
                <div className="bg-mist/50 relative h-3 w-full overflow-hidden rounded-full">
                  <div className="bg-cerulean-deep h-full rounded-full" style={{ width: "32.8%" }} />
                  <div
                    className="bg-signal-blue/70 absolute top-0 h-full rounded-r-full"
                    style={{ left: "30.2%", width: "2.8%" }}
                  />
                </div>
                <div className="text-ash flex justify-between font-mono text-[10px]">
                  <span>0.00 baseline</span>
                  <span>0.315 floor</span>
                  <span>0.342 redemption</span>
                  <span>1.00 par NAV</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        <ScrollReveal>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Source / mechanism</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Update cadence</TableHead>
                <TableHead>Investor protection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TIERS.map((tier, index) => (
                <TableRow key={tier.tier}>
                  <TableCell className="font-medium">
                    {index + 1}. {tier.label}
                  </TableCell>
                  <TableCell className="text-charcoal">{tier.source}</TableCell>
                  <TableCell className="text-right font-mono">{tier.value} mUSD</TableCell>
                  <TableCell className="text-ash font-mono text-xs">{tier.cadence}</TableCell>
                  <TableCell className="text-charcoal">{tier.protection}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollReveal>
      </div>
    </section>
  );
}
