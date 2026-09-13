import type {
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle, NavPoint } from "@/lib/api";
import { toPlotNumber } from "@/lib/format";

/**
 * Mapping from the API's decimal-string candles to the chart library's numeric series data.
 *
 * This is the only place a money string becomes a JavaScript number, and it is a rendering
 * concern (the same allowance `toPlotNumber` already documents): the values feed pixels, never a
 * balance or a transaction. Times are unix seconds, sorted and de-duplicated, because the chart
 * requires strictly ascending unique times.
 */

function sortedUniqueTimes<T extends { timestamp: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const item of [...items].sort((a, b) => a.timestamp - b.timestamp)) {
    if (seen.has(item.timestamp)) continue;
    seen.add(item.timestamp);
    out.push(item);
  }
  return out;
}

export function toCandlestickData(candles: Candle[]): CandlestickData<UTCTimestamp>[] {
  return sortedUniqueTimes(candles).map((candle) => ({
    time: candle.timestamp as UTCTimestamp,
    open: toPlotNumber(candle.open),
    high: toPlotNumber(candle.high),
    low: toPlotNumber(candle.low),
    close: toPlotNumber(candle.close),
  }));
}

/** Stable volume histogram. Colour is decided by the caller (up/down tint). */
export function toVolumeData(candles: Candle[]): HistogramData<UTCTimestamp>[] {
  return sortedUniqueTimes(candles).map((candle) => ({
    time: candle.timestamp as UTCTimestamp,
    value: toPlotNumber(candle.volumeStable),
  }));
}

/**
 * NAV as a step series, padded to the candle window so it spans the whole chart even when the
 * verifier has published only a few values inside it. Padding carries the nearest value forward,
 * which is exactly what a step line is: NAV holds until the next update.
 */
export function toNavStepSeries(
  nav: NavPoint[],
  window: { from: number; to: number },
): LineData<UTCTimestamp>[] {
  const points = sortedUniqueTimes(nav).map((point) => ({
    time: point.timestamp as UTCTimestamp,
    value: toPlotNumber(point.nav),
  }));
  if (points.length === 0) return [];

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const padded: LineData<UTCTimestamp>[] = [];

  if (first.time > window.from) padded.push({ time: window.from as UTCTimestamp, value: first.value });
  padded.push(...points);
  if (last.time < window.to) padded.push({ time: window.to as UTCTimestamp, value: last.value });
  return padded;
}

/** The untimed reference values drawn as horizontal price lines. */
export function referenceLines(input: {
  floorPrice: string | null;
  floorCovered: boolean;
  parity: string | null;
}): Array<{ price: number; title: string }> {
  const lines: Array<{ price: number; title: string }> = [];
  if (input.floorPrice !== null) {
    lines.push({
      price: toPlotNumber(input.floorPrice),
      title: `Floor · ${input.floorCovered ? "covered" : "not covered"}`,
    });
  }
  if (input.parity !== null) {
    lines.push({ price: toPlotNumber(input.parity), title: "Parity · schedule target" });
  }
  return lines;
}