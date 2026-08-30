"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataSourceBadge, PanelError, PanelLoading } from "@/components/data-source";
import { useCandles, useMetrics } from "@/lib/queries";
import { formatPrice, formatTime, toPlotNumber } from "@/lib/format";
import type { CandleInterval } from "@/lib/api";

/**
 * The candle chart, now fed by `/v1/assets/:assetId/candles`.
 *
 * Three things the fixture version got to ignore and this one cannot:
 *  - the Y domain comes from the data, not a hardcoded `[0.78, 1.06]`;
 *  - the X axis is real unix time, not the string `"09:00"`; and
 *  - a bucket with no trades is drawn flat, not as a candle, because a candle implies a
 *    high and a low that somebody actually traded through.
 *
 * `source` decides the badge. On Anvil the pool emits no canonical swaps, so the series is
 * synthetic and says so.
 */

const PERIODS: Array<{ label: string; interval: CandleInterval }> = [
  { label: "1H", interval: 60 },
  { label: "1D", interval: 3600 },
  { label: "1W", interval: 14400 },
  { label: "1M", interval: 86400 },
];

interface CandlePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  range: [number, number];
  empty: boolean;
  nav: number | null;
  floor: number | null;
  twap: number | null;
}

type CandleShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlePoint;
};

function CandlestickShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) return null;

  // A bucket nobody traded in gets a flat mark, not a body with an invented range.
  if (payload.empty || payload.high === payload.low) {
    const midpoint = y + height / 2;
    return (
      <line
        x1={x + width * 0.2}
        x2={x + width * 0.8}
        y1={midpoint}
        y2={midpoint}
        stroke="#4c5a51"
        strokeWidth={1.2}
      />
    );
  }

  const bullish = payload.close >= payload.open;
  const color = bullish ? "#b7f765" : "#ff7f73";
  const center = x + width / 2;
  const toY = (price: number) => y + ((payload.high - price) / (payload.high - payload.low)) * height;
  const openY = toY(payload.open);
  const closeY = toY(payload.close);
  const bodyY = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 3);
  const bodyWidth = Math.max(Math.min(width * 0.56, 18), 7);

  return (
    <g>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1.4} />
      <rect
        x={center - bodyWidth / 2}
        y={bodyY}
        width={bodyWidth}
        height={bodyHeight}
        rx={1.5}
        fill={bullish ? color : "#171e18"}
        stroke={color}
        strokeWidth={1.5}
      />
    </g>
  );
}

export function PriceChart({ assetId }: { assetId?: string }) {
  const [interval, setInterval] = useState<CandleInterval>(3600);
  const candles = useCandles(assetId, interval);
  const metrics = useMetrics(assetId);

  if (candles.isPending) return <PanelLoading label="Loading market history" />;
  if (candles.error !== null) return <PanelError error={candles.error} onRetry={candles.refetch} />;
  if (candles.data === undefined) return <PanelError error={new Error("no candle data")} />;

  const series = candles.data.data;
  const meta = candles.data.meta;

  // Overlays are separate reads, not candle columns: NAV and the floor are not market prices
  // and must not be implied to move with a trade.
  const nav = metrics.data?.data.nav.value ?? null;
  const floor = metrics.data?.data.floorReference.value ?? null;
  const twap = metrics.data?.data.twap?.value.value ?? null;

  const points: CandlePoint[] = series.candles.map((candle) => ({
    timestamp: candle.timestamp,
    open: toPlotNumber(candle.open),
    high: toPlotNumber(candle.high),
    low: toPlotNumber(candle.low),
    close: toPlotNumber(candle.close),
    range: [toPlotNumber(candle.low), toPlotNumber(candle.high)],
    empty: candle.tradeCount === 0,
    nav: nav === null ? null : toPlotNumber(nav),
    floor: floor === null ? null : toPlotNumber(floor),
    twap: twap === null ? null : toPlotNumber(twap),
  }));

  // Domain from the data, padded, never a literal.
  const values = points.flatMap((point) => [point.low, point.high]);
  for (const overlay of [nav, floor, twap]) {
    if (overlay !== null) values.push(toPlotNumber(overlay));
  }
  const low = values.length === 0 ? 0 : Math.min(...values);
  const high = values.length === 0 ? 1 : Math.max(...values);
  const padding = Math.max((high - low) * 0.08, 0.01);

  return (
    <div className="chart-wrap" aria-label="SOLAR01 candlestick chart with NAV, TWAP and protected floor reference">
      <div className="trading-chart-toolbar">
        <div className="chart-periods">
          {PERIODS.map((period) => (
            <button
              className={interval === period.interval ? "active" : ""}
              key={period.label}
              onClick={() => setInterval(period.interval)}
              type="button"
            >
              {period.label}
            </button>
          ))}
        </div>
        <DataSourceBadge
          meta={meta}
          provenance={series.source === "mock" ? "mock" : "derived"}
        />
      </div>

      {points.length === 0 ? (
        <div className="panel-state empty">
          <span>No trades in this range yet.</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={points} margin={{ top: 22, right: 8, left: 2, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke="#243129" strokeDasharray="2 5" vertical={false} />
            <XAxis
              dataKey="timestamp"
              stroke="#708078"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => formatTime(Number(value))}
            />
            <YAxis
              orientation="right"
              domain={[low - padding, high + padding]}
              stroke="#708078"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => Number(value).toFixed(3)}
              width={52}
            />
            <Tooltip
              contentStyle={{ background: "#121813", border: "1px solid #344038", borderRadius: 8 }}
              labelStyle={{ color: "#8e9b93", fontSize: 11, marginBottom: 6 }}
              itemStyle={{ fontSize: 11 }}
              labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleString()}
              formatter={(value, name) => {
                if (Array.isArray(value)) {
                  return [`${Number(value[0]).toFixed(3)} – ${Number(value[1]).toFixed(3)} mUSD`, "Low / High"];
                }
                return [`${Number(value).toFixed(3)} mUSD`, String(name)];
              }}
            />
            <Bar dataKey="range" name="Range" shape={<CandlestickShape />} isAnimationActive={false} />
            {twap !== null && <Line type="monotone" dataKey="twap" name="30m TWAP" stroke="#8ea9ff" strokeWidth={1.4} dot={false} />}
            {nav !== null && <Line type="monotone" dataKey="nav" name="Verified NAV" stroke="#eef0e8" strokeDasharray="4 5" strokeWidth={1.3} dot={false} />}
            {floor !== null && <Line type="monotone" dataKey="floor" name="Floor reference" stroke="#ffb36b" strokeDasharray="7 5" strokeWidth={1.7} dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="chart-legend">
        <span className="spot">Market candles</span>
        <span className="bearish">Down candle</span>
        {twap !== null && <span className="twap">30m TWAP</span>}
        {nav !== null && <span className="nav">Verified NAV</span>}
        {floor !== null && <span className="floor">Protected floor ref. · {formatPrice(floor)} mUSD</span>}
      </div>

      {series.source === "mock" && (
        <p className="chart-disclosure mock-note">
          This series is a labelled demo feed. The local pool does not emit canonical swaps, so
          there is no real price discovery behind these candles.
        </p>
      )}
    </div>
  );
}
