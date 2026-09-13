import { useState } from "react";
import { Link } from "react-router-dom";
import { DataPanel } from "@/components/data-source";
import { FeaturedOffering } from "@/components/offerings/featured-offering";
import { KycStatus } from "@/components/offerings/kyc-status";
import type { AssetListItem } from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import { useAssets } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Offerings screen (Stitch `launchpad_offerings`), wired to `/v1/assets` + `/metrics`.
 *
 * The reference's false claims are redesigned to the truth rather than deleted: the network chip
 * names the connected chain (not Base Sepolia), the yield tile shows realised distributions, and
 * the audit/ERC-3643 badges become "permissioned token (demo KYC)". Pipeline entries render only
 * when a Pending/Approved asset actually exists on the chain.
 */
export function OfferingsPage() {
  const { chainId } = useChain();
  const assets = useAssets();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="bg-linen text-charcoal inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
            <span className="bg-signal-blue h-1.5 w-1.5 rounded-full" />
            {chainName(chainId)}
          </span>
          <KycStatus />
        </div>
        <div className="space-y-1.5">
          <h1 className="font-display text-ink text-3xl tracking-tight sm:text-4xl">
            Primary offerings — real assets, programmable yield
          </h1>
          <p className="text-charcoal max-w-2xl text-sm leading-relaxed">
            Tokenised infrastructure participation. Every figure here is read from the indexed
            chain for the selected network; the floor is a published reference, not a guarantee.
          </p>
        </div>
      </header>

      <DataPanel query={assets} loadingLabel="Loading offerings">
        {(items) => <OfferingsBody items={items} />}
      </DataPanel>

      <ReserveMechanics />
    </div>
  );
}

function OfferingsBody({ items }: { items: AssetListItem[] }) {
  const categories = ["All", ...Array.from(new Set(items.map((item) => item.category)))];
  const [category, setCategory] = useState("All");

  const filtered = category === "All" ? items : items.filter((item) => item.category === category);
  const featured = filtered.find((item) => item.status === "Active") ?? filtered[0];
  const pipeline = filtered.filter((item) => item !== featured);

  if (items.length === 0) {
    return (
      <div className="border-mist text-ash rounded-lg border border-dashed px-3 py-10 text-center text-sm">
        No offerings are indexed for this network.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs transition-colors",
              category === name
                ? "bg-dusk text-paper"
                : "bg-linen text-charcoal hover:bg-mist/60",
            )}
          >
            {name}
            {name === "All" ? ` (${items.length})` : ""}
          </button>
        ))}
      </div>

      {featured !== undefined && <FeaturedOffering asset={featured} />}

      {pipeline.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-ink text-xl">Pipeline &amp; verification queue</h2>
            <span className="text-ash text-xs">{pipeline.length} in review</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {pipeline.map((item) => (
              <PipelineCard key={item.assetId} asset={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Only real Pending/Approved assets appear here; no invented target raises, APR or audit. */
function PipelineCard({ asset }: { asset: AssetListItem }) {
  return (
    <Link
      to={`/assets/${asset.slug}`}
      className="bg-paper border-mist hover:border-cerulean block rounded-xl border p-4 transition-colors"
    >
      <span className="text-ash text-[11px] tracking-tight uppercase">
        {asset.symbol} • {asset.category}
      </span>
      <h3 className="font-display text-ink mt-1 text-lg leading-snug">{asset.name}</h3>
      <span className="text-cerulean-deep mt-2 inline-block text-xs">{asset.status}</span>
    </Link>
  );
}

/**
 * What actually enforces this. Honest substitute for the reference's "Bankruptcy-Remote SPV",
 * "Basel III" and "Instant Telemetric Slashing" panel, none of which exists (D-027).
 */
function ReserveMechanics() {
  return (
    <section className="bg-linen rounded-xl p-4 sm:p-5">
      <h2 className="font-display text-ink text-lg">Reserve mechanics, as enforced on chain</h2>
      <div className="text-charcoal mt-3 grid gap-3 text-xs leading-relaxed sm:grid-cols-3">
        <p>
          Each primary purchase splits <b className="text-ink">65 / 30 / 5</b> into issuer
          proceeds, the redemption reserve and a market-making allocation. The split is fixed in
          the offering contract; the 30% is the only collateral that backs redemptions.
        </p>
        <p>
          Redemption pays <b className="text-ink">min(NAV, liquid backing per token)</b>, subject
          to a per-period limit. It never pays the published floor, and NAV is verifier-published
          and can go stale.
        </p>
        <p>
          Revenue deposits split <b className="text-ink">60 / 25 / 10 / 5</b> while the vault is
          on schedule, and <b className="text-ink">40 / 45 / 10 / 5</b> once it falls behind. There
          is no audit, legal wrapper or guaranteed return.
        </p>
      </div>
    </section>
  );
}
