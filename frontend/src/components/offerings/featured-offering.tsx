import { ArrowRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { DataPanel, DataSourceBadge } from "@/components/data-source";
import { SubscribePanel } from "@/components/offerings/subscribe-panel";
import { Button } from "@/components/ui/button";
import type { AssetListItem, AssetMetrics, ResponseMeta } from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import { chainName } from "@/lib/chains";
import { formatAmount, formatPrice, shortAddress, toPlotNumber } from "@/lib/format";
import { useMetrics, useRevenue } from "@/lib/queries";

/**
 * The featured offering. Every figure is served or derived; the reference's WRONG elements are
 * present in shape but redesigned to the truth:
 *  - "Est. Cash Yield 14.8% APR" becomes realised distributions to date, labelled historical;
 *  - "Sinking Floor, guaranteed" becomes the published floor **with its coverage**;
 *  - "Tenor & Par Peg" becomes the schedule's maturity and target backing.
 */
export function FeaturedOffering({ asset }: { asset: AssetListItem }) {
  const { chainId } = useChain();
  const metrics = useMetrics(asset.assetId);
  const revenue = useRevenue(asset.assetId);

  return (
    <article className="bg-paper border-mist relative flex flex-col overflow-hidden rounded-xl border">
      <div className="from-dusk to-charcoal relative h-36 w-full bg-gradient-to-br via-[#3a3a4a]">
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <span className="bg-paper/90 text-ink rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-md">
            {asset.status === "Active" ? "Primary stage" : asset.status}
          </span>
          <span className="bg-paper/90 text-ash rounded-full px-2.5 py-1 text-[11px]">
            {chainName(chainId)}
          </span>
        </div>
        <div className="text-paper absolute bottom-3 left-3">
          <span className="text-mist text-[11px] tracking-wide uppercase">
            {asset.symbol} • {asset.category}
          </span>
          <h2 className="font-display text-paper mt-0.5 text-2xl">{asset.name}</h2>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <DataPanel query={metrics} loadingLabel="Loading offering">
          {(m, meta) => (
            <OfferingBody asset={asset} m={m} meta={meta} distributed={revenue.data?.data.totalHolder} />
          )}
        </DataPanel>
      </div>
    </article>
  );
}

function OfferingBody({
  asset,
  m,
  meta,
  distributed,
}: {
  asset: AssetListItem;
  m: AssetMetrics;
  meta: ResponseMeta;
  distributed: string | undefined;
}) {
  const progress = progressPercent(m.offering.raised, m.offering.cap);
  const remaining = subtractDecimal(m.offering.cap, m.offering.raised);

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <span className="text-ash text-[11px] tracking-tight uppercase">Subscribed</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-ink text-lg font-semibold">{formatAmount(m.offering.raised)}</span>
            <span className="text-ash text-xs">/ {formatAmount(m.offering.cap)} mUSD</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <DataSourceBadge meta={meta} />
          <span className="text-cerulean-deep text-xs font-medium">
            Remaining {formatAmount(remaining)} mUSD
          </span>
        </div>
      </div>

      <div className="bg-linen h-2 w-full overflow-hidden rounded-full">
        <div
          className="from-cerulean-deep to-signal-blue h-full rounded-full bg-gradient-to-r"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="Issue price" value={`${formatPrice(m.offering.price)} mUSD`} sub="per token" />
        <Tile
          label="Distributed to holders"
          value={distributed === undefined ? "—" : `${formatAmount(distributed)} mUSD`}
          sub="realised, not a forecast"
        />
        <Tile
          label="Sinking floor"
          value={m.floor === null ? "—" : `${formatPrice(m.floor.price)} mUSD`}
          sub={m.floor === null ? "no floor controller" : m.floor.covered ? "covered" : "not covered"}
          tone={m.floor !== null && m.floor.covered ? "ok" : "warn"}
        />
        <Tile
          label="Tenor & target"
          value={m.reserveSchedule === null ? "—" : formatMonths(m.reserveSchedule.maturity)}
          sub={
            m.reserveSchedule === null
              ? "no schedule"
              : `par ${formatPrice(m.reserveSchedule.targetBacking)} mUSD`
          }
        />
      </div>

      <div className="bg-linen/60 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs">
        <span className="text-charcoal">
          Min. ticket <b className="text-ink font-medium">{formatAmount(m.offering.minimumPurchase)} mUSD</b>
        </span>
        <span className="text-charcoal">
          Closes <b className="text-ink font-medium">{countdown(m.offering.endsAt)}</b>
        </span>
        <span className="text-charcoal">
          Verified NAV <b className="text-ink font-medium">{formatPrice(m.nav.value)} mUSD</b>
          {m.nav.stale && <span className="text-provenance-mock"> · stale</span>}
        </span>
        <span className="text-charcoal">
          Reserve <b className="text-ink font-medium">{solvencyLabel(m)}</b>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild className="flex-1">
          <Link to={`/assets/${asset.slug}`}>
            View offering &amp; subscribe
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <p className="text-ash flex items-center gap-1.5 text-[11px]">
        <MapPin size={12} aria-hidden="true" />
        {asset.symbol} • {asset.category} • issuer {shortAddress(asset.issuer)} •{" "}
        {chainName(meta.chainId)}. Vault holdings redeem at min(NAV, backing); the floor is a
        published reference, not a guarantee.
      </p>

      <SubscribePanel symbol={asset.symbol} price={m.offering.price} />
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="bg-linen space-y-1 rounded-lg p-3">
      <span className="text-ash text-[11px]">{label}</span>
      <p className="text-ink text-sm font-medium">{value}</p>
      <span
        className={
          tone === "warn"
            ? "text-provenance-mock text-[11px]"
            : tone === "ok"
              ? "text-provenance-live text-[11px]"
              : "text-ash text-[11px]"
        }
      >
        {sub}
      </span>
    </div>
  );
}

/** A percentage for a bar width only. Money arithmetic stays in the API's decimal strings. */
function progressPercent(raised: string, cap: string): number {
  const capValue = toPlotNumber(cap);
  if (capValue <= 0) return 0;
  return Math.max(0, Math.min(100, (toPlotNumber(raised) / capValue) * 100));
}

/** Subtract two decimal strings for display, via scaled integers to avoid float drift. */
function subtractDecimal(a: string, b: string): string {
  const scale = 6;
  const toInt = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(scale, "0").slice(0, scale));
  };
  const diff = toInt(a) - toInt(b);
  const negative = diff < 0n;
  const digits = (negative ? -diff : diff).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction.length === 0 ? "" : `.${fraction}`}`;
}

function solvencyLabel(m: AssetMetrics): string {
  if (m.reserveSchedule === null) return "—";
  if (m.reserveSchedule.inEnforcedShortfall) return "shortfall enforced";
  if (m.reserveSchedule.behindSchedule) return "behind schedule";
  return "on schedule";
}

function countdown(endsAt: number): string {
  const seconds = endsAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "closed";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatMonths(maturity: number): string {
  const seconds = maturity - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "matured";
  const months = Math.floor(seconds / (30 * 86_400));
  return `${months} mo`;
}
