import { liquidityPositions, marketPipeline, priceHistory, solarAsset } from "@/lib/data";
import type { AssetListItem, Candles, Envelope, Positions } from "@/lib/api";
import { fixtureEnvelope } from "@/lib/api";

/**
 * The fixture adapter.
 *
 * `data.ts` predates the API and is shaped for JSX, not for the contract. These functions
 * translate it into the same shapes the backend returns, so a component reads one type
 * regardless of where the data came from and decides what to render from `meta.provenance`
 * alone — never from a "are we in demo mode" branch scattered through the tree.
 *
 * This is only reached when no `NEXT_PUBLIC_API_URL` is configured. A *failed* request against
 * a configured backend never lands here (D-019): that is an error state.
 */

const toDecimal = (value: number, decimals: number): string => value.toFixed(decimals);

export function fixtureAssets(): Envelope<AssetListItem[]> {
  return fixtureEnvelope(
    marketPipeline.map((entry, index): AssetListItem => {
      const live = entry.status === "Live";
      return {
        assetId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
        slug: entry.href?.replace("/assets/", "") ?? entry.symbol.toLowerCase(),
        name: entry.name,
        symbol: entry.symbol,
        category: entry.category,
        status: live ? "Active" : "Pending",
        issuer: `0x${"0".repeat(40)}`,
        spot: live ? { value: toDecimal(solarAsset.spot, 6), provenance: "mock" } : null,
        floor: live ? toDecimal(solarAsset.floor, 6) : null,
        reserve: live ? toDecimal(solarAsset.reserve, 6) : null,
        change24h: live ? "1.80" : null,
        contracts: null,
      };
    }),
  );
}

export function fixtureCandles(): Envelope<Candles> {
  return fixtureEnvelope({
    interval: 3600,
    source: "mock",
    candles: priceHistory.map((point, index) => ({
      // The fixture carried clock labels ("09:00"); the contract is unix seconds, so the
      // adapter has to invent a timeline rather than pass a string through.
      timestamp: Math.floor(Date.now() / 1000) - (priceHistory.length - 1 - index) * 3600,
      open: toDecimal(point.open, 6),
      high: toDecimal(point.high, 6),
      low: toDecimal(point.low, 6),
      close: toDecimal(point.close, 6),
      volumeAsset: "0.000000000000000000",
      volumeStable: "0.000000",
      tradeCount: 1,
      finalized: index < priceHistory.length - 1,
    })),
  });
}

export function fixturePositions(): Envelope<Positions> {
  const kinds = {
    floor: "ReserveFloor",
    anchor: "Anchor",
    discovery: "Discovery",
    intermediary: "Intermediary",
  } as const;

  return fixtureEnvelope({
    assetIsToken0: false,
    tickSpacing: 60,
    currentTick: null,
    positions: liquidityPositions.map((position) => {
      const [lower, upper] = position.range.replace(" mUSD", "").split(" - ");
      return {
        kind: kinds[position.id],
        configured: true,
        tickLower: 0,
        tickUpper: 0,
        priceLower: lower === undefined ? null : toDecimal(Number(lower), 6),
        priceUpper: upper === undefined ? null : toDecimal(Number(upper), 6),
        // The fixture's "7,200 mUSD" was never liquidity — real positions expose a raw
        // uint128 that cannot be converted to an amount without the curve.
        liquidity: "0",
        lastAction: null,
      };
    }),
  });
}
