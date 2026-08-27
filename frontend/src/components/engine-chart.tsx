"use client";

import { ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

const marker = [{ x: 1.018, y: 1 }];

export function EngineChart() {
  return (
    <div className="engine-chart" aria-label="ARC Engine concentrated liquidity ranges">
      <ResponsiveContainer width="100%" height={330}>
        <ScatterChart margin={{ top: 24, right: 18, bottom: 18, left: 6 }}>
          <XAxis type="number" dataKey="x" domain={[0.68, 1.34]} ticks={[0.7, 0.82, 0.94, 1.0, 1.06, 1.18, 1.3]} stroke="#718690" tickFormatter={(v) => `${v.toFixed(2)}`} />
          <YAxis type="number" hide domain={[0, 1.2]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => `${Number(v).toFixed(3)} mUSD`} />
          <ReferenceArea x1={0.7} x2={0.88} fill="#5aa58f" fillOpacity={0.24} label={{ value: "MARKET FLOOR RANGE", fill: "#8bbdad", fontSize: 10 }} />
          <ReferenceArea x1={0.88} x2={0.96} fill="#577889" fillOpacity={0.2} label={{ value: "INTERMEDIARY", fill: "#8ca5b0", fontSize: 10 }} />
          <ReferenceArea x1={0.96} x2={1.08} fill="#78e1bb" fillOpacity={0.25} label={{ value: "ANCHOR", fill: "#79f2c0", fontSize: 11 }} />
          <ReferenceArea x1={1.08} x2={1.3} fill="#657bcb" fillOpacity={0.22} label={{ value: "DISCOVERY", fill: "#9cadf0", fontSize: 10 }} />
          <ReferenceLine x={1.0} stroke="#d7c277" strokeDasharray="5 5" label={{ value: "NAV 1.000", fill: "#d7c277", position: "insideTopLeft" }} />
          <ReferenceLine x={1.006} stroke="#7ba5ff" strokeDasharray="2 4" label={{ value: "TWAP", fill: "#7ba5ff", position: "insideBottomLeft" }} />
          <Scatter data={marker} fill="#79f2c0" shape="circle" name="Spot" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
