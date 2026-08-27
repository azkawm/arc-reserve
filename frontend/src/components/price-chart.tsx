"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { priceHistory } from "@/lib/data";

type CandlePoint = (typeof priceHistory)[number] & { range: [number, number] };

type CandleShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlePoint;
};

function CandlestickShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload || payload.high === payload.low) return null;

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
      <rect x={center - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx={1.5} fill={bullish ? color : "#171e18"} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

export function PriceChart() {
  const [period, setPeriod] = useState("1D");
  const candleHistory: CandlePoint[] = priceHistory.map((point) => ({ ...point, range: [point.low, point.high] }));

  return (
    <div className="chart-wrap" aria-label="SOLAR01 mock candlestick chart with market, NAV, TWAP, and protected floor reference">
      <div className="trading-chart-toolbar">
        <div className="chart-periods">
          {['1H', '1D', '1W', '1M'].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)} type="button">{item}</button>)}
        </div>
        <span><i /> Mock market feed</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={candleHistory} margin={{ top: 22, right: 8, left: 2, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="#243129" strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="time" stroke="#708078" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
          <YAxis orientation="right" domain={[0.78, 1.06]} stroke="#708078" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(2)} width={42} />
          <Tooltip
            contentStyle={{ background: "#121813", border: "1px solid #344038", borderRadius: 8, boxShadow: "0 16px 40px rgba(0,0,0,.32)" }}
            labelStyle={{ color: "#8e9b93", fontSize: 11, marginBottom: 6 }}
            itemStyle={{ fontSize: 11 }}
            formatter={(value, name) => {
              if (Array.isArray(value)) return [`${Number(value[0]).toFixed(3)} – ${Number(value[1]).toFixed(3)} mUSD`, "Low / High"];
              return [`${Number(value).toFixed(3)} mUSD`, String(name).replace(/^./, (letter) => letter.toUpperCase())];
            }}
          />
          <Bar dataKey="range" name="Range" shape={<CandlestickShape />} isAnimationActive={false} />
          <Line type="monotone" dataKey="twap" stroke="#8ea9ff" strokeWidth={1.4} dot={false} />
          <Line type="monotone" dataKey="nav" stroke="#eef0e8" strokeDasharray="4 5" strokeWidth={1.3} dot={false} />
          <Line type="monotone" dataKey="floor" stroke="#ffb36b" strokeDasharray="7 5" strokeWidth={1.7} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        <span className="spot">Market candles</span><span className="bearish">Down candle</span><span className="twap">30m TWAP</span><span className="nav">Verified NAV</span><span className="floor">Protected floor ref. · 0.820 mUSD</span>
      </div>
    </div>
  );
}
