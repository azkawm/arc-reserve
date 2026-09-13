import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  type MouseEventParams,
} from "lightweight-charts";
import type { Candle, NavPoint } from "@/lib/api";
import {
  referenceLines,
  toCandlestickData,
  toNavStepSeries,
  toVolumeData,
} from "@/lib/chart-data";
import { formatPrice } from "@/lib/format";

/**
 * The SOLAR01 price chart: TradingView Lightweight Charts.
 *
 * Candles and volume come from the Uniswap pool (`/candles`). The step line is the
 * verifier-published NAV (`/nav-history`) and holds until the next update. The published floor and
 * the schedule target are horizontal reference lines, not derived from the pool's current tick:
 * spot is the pool price, the floor is a published reference, and NAV is a verifier number — the
 * three must never collapse into one (CLAUDE.md rule 4).
 *
 * Rendered as canvas, so a collapsible table carries the same candle and reference values for
 * screen readers and where the canvas is unavailable (FRONTEND.md §12).
 */

interface CandlestickChartProps {
  candles: Candle[];
  nav: NavPoint[];
  floorPrice: string | null;
  floorCovered: boolean;
  parity: string | null;
  symbol: string;
}

interface Quote {
  open: number;
  high: number;
  low: number;
  close: number;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function CandlestickChart({
  candles,
  nav,
  floorPrice,
  floorCovered,
  parity,
  symbol,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Quote | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const live = cssVar("--provenance-live", "#15803d");
    const error = cssVar("--arc-error", "#ba1a1a");
    const ash = cssVar("--arc-ash", "#646464");
    const mist = cssVar("--arc-mist", "#dee2de");
    const parchment = cssVar("--arc-parchment", "#fefffc");
    const cerulean = cssVar("--arc-cerulean-deep", "#006ba3");
    const mock = cssVar("--provenance-mock", "#b45309");

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: parchment },
        textColor: ash,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: mist },
        horzLines: { color: mist },
      },
      rightPriceScale: { borderColor: mist },
      timeScale: { borderColor: mist, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: live,
      downColor: error,
      borderVisible: false,
      wickUpColor: live,
      wickDownColor: error,
    });
    const candleData = toCandlestickData(candles);
    candleSeries.setData(candleData);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      toVolumeData(candles).map((bar) => ({
        ...bar,
        color: `${bar.value >= 0 ? live : error}55`,
      })),
    );

    const navSeries = chart.addSeries(LineSeries, {
      color: cerulean,
      lineWidth: 2,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "NAV",
    });
    if (candleData.length > 0) {
      const first = candleData[0]!.time as number;
      const last = candleData[candleData.length - 1]!.time as number;
      navSeries.setData(toNavStepSeries(nav, { from: first, to: last }));
    }

    for (const line of referenceLines({ floorPrice, floorCovered, parity })) {
      candleSeries.createPriceLine({
        price: line.price,
        color: line.title.startsWith("Floor") ? mock : ash,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.title,
      });
    }

    const onCrosshair = (param: MouseEventParams) => {
      const data = param.seriesData.get(candleSeries);
      if (data !== undefined && "open" in data) {
        setHovered({ open: data.open, high: data.high, low: data.low, close: data.close });
      } else {
        setHovered(null);
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
    };
  }, [candles, nav, floorPrice, floorCovered, parity]);

  const lastData = toCandlestickData(candles);
  const last = lastData.length > 0 ? lastData[lastData.length - 1]! : null;
  const latest: Quote | null =
    hovered ??
    (last === null
      ? null
      : { open: last.open, high: last.high, low: last.low, close: last.close });
  const change =
    latest === null || latest.open === 0 ? null : ((latest.close - latest.open) / latest.open) * 100;

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={containerRef} className="h-[320px] w-full" />
        <div className="bg-paper/80 pointer-events-none absolute top-2 left-2 rounded-md px-2 py-1 text-[11px] backdrop-blur-sm">
          <span className="text-ink font-medium">{symbol}</span>
          {latest !== null && (
            <span className="text-charcoal ml-2 font-mono">
              O {formatPrice(String(latest.open))} H {formatPrice(String(latest.high))} L{" "}
              {formatPrice(String(latest.low))} C {formatPrice(String(latest.close))}
            </span>
          )}
          {change !== null && (
            <span className={change >= 0 ? "text-provenance-live ml-2" : "text-destructive ml-2"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
          {hovered === null && <span className="text-ash ml-2">latest</span>}
          <span className="text-cerulean-deep ml-2">NAV →</span>
          {floorPrice !== null && (
            <span className="text-provenance-mock ml-2">
              Floor {formatPrice(floorPrice)} ({floorCovered ? "covered" : "not covered"})
            </span>
          )}
          {parity !== null && <span className="text-ash ml-2">Parity {formatPrice(parity)}</span>}
        </div>
      </div>

      <details className="text-charcoal text-xs">
        <summary className="text-ash hover:text-ink cursor-pointer">Data table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left">
            <caption className="sr-only">
              Candle and reference values for {symbol}
            </caption>
            <thead className="text-ash">
              <tr>
                <th scope="col" className="py-1 pr-3">Time</th>
                <th scope="col" className="py-1 pr-3">Open</th>
                <th scope="col" className="py-1 pr-3">High</th>
                <th scope="col" className="py-1 pr-3">Low</th>
                <th scope="col" className="py-1 pr-3">Close</th>
              </tr>
            </thead>
            <tbody>
              {candles.slice(-30).reverse().map((candle) => (
                <tr key={candle.timestamp} className="border-mist border-t">
                  <td className="py-1 pr-3">{new Date(candle.timestamp * 1000).toLocaleString()}</td>
                  <td className="py-1 pr-3">{formatPrice(candle.open)}</td>
                  <td className="py-1 pr-3">{formatPrice(candle.high)}</td>
                  <td className="py-1 pr-3">{formatPrice(candle.low)}</td>
                  <td className="py-1 pr-3">{formatPrice(candle.close)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-ash mt-2">
            NAV {nav.length === 0 ? "—" : formatPrice(nav[nav.length - 1]!.nav)} · Floor{" "}
            {floorPrice === null ? "—" : `${formatPrice(floorPrice)} (${floorCovered ? "covered" : "not covered"})`} ·
            Parity {parity === null ? "—" : formatPrice(parity)}
          </p>
        </div>
      </details>
    </div>
  );
}

export default CandlestickChart;