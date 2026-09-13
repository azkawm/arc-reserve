import { formatUnits } from "viem";
import type { ActivityItem } from "@/lib/api";
import { MUSD_DECIMALS, TOKEN_DECIMALS } from "@/lib/contracts";

/**
 * The swap/purchase history rows for the trading desk, derived from `/activity`.
 *
 * A `Swap` (SwapExactInput) summary carries `tokenIn`, `amountSpent`, `amountOut` and
 * `amountRequested` as **raw base units**; the direction is decided by comparing `tokenIn` with
 * the asset's token, never assumed. A `Purchase` (TokensPurchased) carries human-unit
 * `stablecoinAmount`/`tokenAmount`. `amountSpent` is the trade size — `amountRequested` only rides
 * along so a partial fill is visible (D-037).
 */
export interface SwapRow {
  id: string;
  timestamp: number;
  kind: "Buy" | "Sell";
  amountIn: string;
  symbolIn: string;
  amountOut: string;
  symbolOut: string;
  partial: boolean;
  txHash: string;
}

function rawAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function toSwapRows(
  items: ActivityItem[],
  context: { tokenAddress: string; stableAddress: string; symbol: string },
): SwapRow[] {
  const assetToken = context.tokenAddress.toLowerCase();
  const stable = context.stableAddress.toLowerCase();
  const rows: SwapRow[] = [];

  for (const item of items) {
    if (item.type === "Purchase") {
      const spent = item.summary.stablecoinAmount;
      const received = item.summary.tokenAmount;
      if (typeof spent !== "string" || typeof received !== "string") continue;
      rows.push({
        id: item.id,
        timestamp: item.timestamp,
        kind: "Buy",
        amountIn: spent,
        symbolIn: "mUSD",
        amountOut: received,
        symbolOut: context.symbol,
        partial: false,
        txHash: item.txHash,
      });
      continue;
    }

    if (item.type !== "Swap") continue;
    const tokenIn = typeof item.summary.tokenIn === "string" ? item.summary.tokenIn.toLowerCase() : "";
    const spent = rawAmount(item.summary.amountSpent);
    const received = rawAmount(item.summary.amountOut);
    const requested = rawAmount(item.summary.amountRequested);
    if (spent === null || received === null) continue;

    const isBuy = tokenIn === stable && tokenIn !== assetToken;
    rows.push({
      id: item.id,
      timestamp: item.timestamp,
      kind: isBuy ? "Buy" : "Sell",
      amountIn: isBuy
        ? formatUnits(spent, MUSD_DECIMALS)
        : formatUnits(spent, TOKEN_DECIMALS),
      symbolIn: isBuy ? "mUSD" : context.symbol,
      amountOut: isBuy
        ? formatUnits(received, TOKEN_DECIMALS)
        : formatUnits(received, MUSD_DECIMALS),
      symbolOut: isBuy ? context.symbol : "mUSD",
      partial: requested !== null && requested > spent,
      txHash: item.txHash,
    });
  }

  return rows.sort((a, b) => b.timestamp - a.timestamp);
}
