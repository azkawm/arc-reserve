import { Building2, CheckCircle2, Users } from "lucide-react";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The two participant pathways, adapted from the reference's "Dual Participant Engine".
 *
 * Rewrites, against the concept-landing-page spec and the project's non-negotiable rules
 * (`CLAUDE.md`): "instantaneous programmatic exit guarantees" and "Exit immediately at
 * min(NAV, backing)" both claim an always-on, unlimited exit — rule 5 is explicit that
 * redemption is reserve-limited, not that promise. "Apply for Origination Audit" and
 * "Institutional Basel III Cap-Weight" are dropped outright, not reworded: the first repeats the
 * banned word "audit", the second invents a regulatory framework this protocol does not
 * implement, and both linked to nowhere real (there is no router yet). The 65/30/5 split,
 * the three-year sinking reserve, and identity-gated transfers are kept close to the reference's
 * own wording because they describe real, implemented mechanics (D-023, the identity registry).
 */
export function DualParticipantEngine() {
  return (
    <section className="px-4 py-14 sm:px-6" id="engine">
      <div className="mx-auto max-w-6xl">
        <div className="border-mist mb-8 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-ash text-xs font-semibold tracking-widest uppercase">
              System Mechanics
            </span>
            <h2 className="text-ink mt-1 text-3xl">Dual Participant Engine</h2>
          </div>
          <p className="text-charcoal max-w-md text-sm">
            Two roles, one shared vault: capital efficiency without collapsing the distinction
            between an investor's claim and an issuer's proceeds.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <ScrollReveal>
            <Card className="border-mist hover:border-signal-blue h-full transition-colors">
              <CardContent className="flex h-full flex-col gap-4 px-6">
                <div className="flex items-center justify-between">
                  <span className="border-mist bg-parchment text-charcoal inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
                    <Users size={12} className="text-signal-blue" aria-hidden="true" />
                    Permissioned Whitelist
                  </span>
                  <span className="text-ash font-mono text-[11px]">Pathway // 01</span>
                </div>
                <h3 className="text-ink text-xl">For Qualified Investors</h3>
                <p className="text-charcoal text-sm leading-relaxed">
                  Participate in real-world utility assets with cryptographic provenance and
                  verified off-taker contracts. Exit is reserve-limited, never an unconditional
                  promise.
                </p>
                <ul className="flex flex-col gap-2.5 pt-1 text-sm">
                  <Bullet title="Fractional Subscription">
                    Enter offerings from a low minimum ticket, permissioned by identity.
                  </Bullet>
                  <Bullet title="Revenue Share">
                    Up to 60% of gross revenue distributed to holders per deposit, schedule-linked
                    rather than fixed (D-023).
                  </Bullet>
                  <Bullet title="Dual-Engine Liquidity">
                    Redeem against the reserve at{" "}
                    <code className="bg-parchment border-mist rounded border px-1 font-mono text-xs">
                      min(NAV, backing)
                    </code>
                    , subject to a period limit — or trade spot on the ARC Uniswap V3 pool.
                  </Bullet>
                </ul>
                <p className="text-ash mt-auto border-mist border-t pt-3 text-[11px]">
                  ERC-3643 identity check on every transfer leg.
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>

          <ScrollReveal>
            <Card className="border-mist hover:border-dusk h-full transition-colors">
              <CardContent className="flex h-full flex-col gap-4 px-6">
                <div className="flex items-center justify-between">
                  <span className="border-mist bg-parchment text-charcoal inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
                    <Building2 size={12} className="text-dusk" aria-hidden="true" />
                    Institutional Originators
                  </span>
                  <span className="text-ash font-mono text-[11px]">Pathway // 02</span>
                </div>
                <h3 className="text-ink text-xl">For Utility &amp; Asset Issuers</h3>
                <p className="text-charcoal text-sm leading-relaxed">
                  Finance capital expenditure against future contracted revenue without equity
                  dilution or opaque secondary repricing.
                </p>
                <ul className="flex flex-col gap-2.5 pt-1 text-sm">
                  <Bullet title="65,000 mUSD Upfront per 100k Raise">
                    Retain operational independence with upfront capital release and zero equity
                    dilution.
                  </Bullet>
                  <Bullet title="Linear Three-Year Sinking Reserve">
                    A transparent amortizing schedule, with the split shifting toward the reserve
                    automatically while backing runs behind it.
                  </Bullet>
                  <Bullet title="Identity-Gated Syndication">
                    Secondary distribution stays restricted to verified, permissioned
                    counterparts.
                  </Bullet>
                </ul>
                <p className="text-ash mt-auto border-mist border-t pt-3 text-[11px]">
                  Category-accounted vault — five separated buckets, never commingled.
                </p>
              </CardContent>
            </Card>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 size={16} className="text-signal-blue mt-0.5 shrink-0" aria-hidden="true" />
      <span className="text-charcoal">
        <strong className="text-ink font-medium">{title}:</strong> {children}
      </span>
    </li>
  );
}
