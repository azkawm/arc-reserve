import { AlertTriangle, CircleDot, Gavel, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    id: 1,
    label: "Behind Schedule",
    icon: CircleDot,
    trigger: "isBehindSchedule() → true",
    detail: "Onchain flag — no enforcement yet",
    description:
      "Backing runs behind the published sinking-fund schedule. A 30-day grace period starts automatically onchain, and the shortfall status is visible to every reader. No penalty is invoked at this stage.",
  },
  {
    id: 2,
    label: "Automatic Shortfall",
    icon: AlertTriangle,
    trigger: "isInEnforcedShortfall() → true",
    detail: "Issuer withdrawals freeze",
    description:
      "Grace expires without recovery. The issuer's remaining proceeds withdrawals freeze immediately, and the revenue split shifts from 60/25/10/5 toward 40/45/10/5 to refill the reserve faster.",
  },
  {
    id: 3,
    label: "Verifier Default",
    icon: ShieldAlert,
    trigger: "markDefault() — verifier",
    detail: "Emergency redemption opens",
    description:
      "Prolonged shortfall (90+ days) or a legal default event lets the verifier mark the asset Defaulted. Emergency redemption opens, paying from whatever the reserve currently holds, capped at NAV.",
  },
  {
    id: 4,
    label: "Lien Enforcement",
    icon: Gavel,
    trigger: "Offchain — trustee action",
    detail: "Legal enforcement, not a contract call",
    description:
      "The token is a secured note. A trustee can enforce the lien over the underlying asset outside the chain; sale proceeds flow back into the reserve for the holders who remain.",
  },
] as const;

/**
 * The four-stage escalation ladder, adapted from the reference — and, alongside
 * `ValueReferences`, the other section describing something the deployed protocol actually
 * implements (`docs/PROPOSAL.en.md` §5's "designed, onchain-enforced escalation ladder").
 *
 * Three corrections from the reference, all substantive rather than stylistic. Its subhead
 * claims smart contract triggers "guarantee" remediation — dropped, same rule as everywhere
 * else on this page. Its stage 2 shifts the split to "85/15" — the real shift is 60/25/10/5 to
 * 40/45/10/5 (D-023); 85/15 is simply the wrong numbers, concept framing or not. And its stage 4
 * names "Singapore arbitration" as the enforcement venue — invented specificity this project has
 * no basis for; `CLAUDE.md` is explicit that the term sheet is still a hash, not an executed
 * legal document, so the copy stays deliberately abstract about jurisdiction. Each stage's
 * "Smart Contract Trigger" caption now names a real `AssetVault` predicate rather than the
 * reference's invented pseudocode threshold.
 */
export function SafetyLadder() {
  const [selectedId, setSelectedId] = useState<(typeof STAGES)[number]["id"]>(1);
  const selected = STAGES.find((stage) => stage.id === selectedId) ?? STAGES[0];

  return (
    <section className="border-mist border-t px-4 py-14 sm:px-6" id="safety-ladder">
      <div className="mx-auto max-w-6xl">
        <div className="border-mist mb-8 flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-ash text-xs font-semibold tracking-widest uppercase">
              Self-Enforcing Failure Mode
            </span>
            <h2 className="text-ink mt-1 text-3xl">Four-Stage Safety Escalation Ladder</h2>
          </div>
          <p className="text-charcoal max-w-md text-sm">
            Smart contract triggers surface remediation early, before legal distress can affect
            investor yield. Select a stage to inspect its trigger.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage) => {
            const isSelected = stage.id === selectedId;
            const Icon = stage.icon;
            return (
              <button
                key={stage.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(stage.id)}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border-2 p-4 text-left shadow-sm transition-colors",
                  isSelected
                    ? "border-cerulean bg-paper"
                    : "border-mist bg-linen hover:border-signal-blue hover:bg-paper",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-ash font-mono text-[11px]">
                    Stage 0{stage.id}
                  </span>
                  <Icon
                    size={16}
                    className={isSelected ? "text-cerulean-deep" : "text-ash"}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="text-ink text-base font-medium">{stage.label}</h3>
                <p className="text-charcoal text-xs leading-relaxed">{stage.detail}</p>
              </button>
            );
          })}
        </div>

        <ScrollReveal>
          <div className="border-signal-blue/40 bg-paper mt-6 flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <selected.icon size={22} className="text-cerulean-deep mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-ink text-sm font-semibold">
                  Stage 0{selected.id} — {selected.label}
                </p>
                <p className="text-charcoal mt-1 text-sm leading-relaxed">
                  {selected.description}
                </p>
              </div>
            </div>
            <span className="bg-linen text-ash border-mist shrink-0 rounded-full border px-3 py-1 font-mono text-[11px]">
              {selected.trigger}
            </span>
          </div>
        </ScrollReveal>

        <div className="border-mist bg-linen mt-4 flex items-start gap-3 rounded-lg border p-4">
          <Gavel size={18} className="text-cerulean-deep mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-charcoal text-xs leading-relaxed">
            <strong className="text-ink font-medium">Boundary disclaimer:</strong> principal and
            yield distributions are protected only to the extent of the verified onchain reserve,
            plus whatever a court enforces under the lien — never more, and never promised as
            more. Within this concept's scope, the trustee and lien exist as term-sheet hashes,
            not executed legal agreements.
          </p>
        </div>
      </div>
    </section>
  );
}
