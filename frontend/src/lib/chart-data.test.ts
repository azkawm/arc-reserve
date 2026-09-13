import { describe, expect, it } from "vitest";
import type { Candle, NavPoint } from "@/lib/api";
import { referenceLines, toCandlestickData, toNavStepSeries, toVolumeData } from "@/lib/chart-data";

function candle(timestamp: number, close: number): Candle {
  return {
    timestamp,
    open: "1.000000",
    high: "1.100000",
    low: "0.900000",
    close: close.toFixed(6),
    volumeAsset: "0.000000000000000000",
    volumeStable: "100.000000",
    tradeCount: 1,
    finalized: true,
  };
}

describe("toCandlestickData", () => {
  it("sorts ascending, de-duplicates by time, and converts to numbers", () => {
    const data = toCandlestickData([candle(300, 1.2), candle(100, 1.0), candle(300, 9.9)]);
    expect(data.map((point) => point.time)).toEqual([100, 300]);
    expect(typeof data[0]?.open).toBe("number");
    // The second 300 is dropped, so the first close survives.
    expect(data[1]?.close).toBeCloseTo(1.2, 6);
  });

  it("returns an empty array for no candles", () => {
    expect(toCandlestickData([])).toEqual([]);
  });
});

describe("toVolumeData", () => {
  it("maps volumeStable to numeric values", () => {
    expect(toVolumeData([candle(100, 1)])).toEqual([{ time: 100, value: 100 }]);
  });
});

describe("toNavStepSeries", () => {
  const nav: NavPoint[] = [
    { timestamp: 200, nav: "1.000000", previousNav: "1.000000", txHash: "0x0" },
    { timestamp: 400, nav: "1.100000", previousNav: "1.000000", txHash: "0x0" },
  ];

  it("pads to the candle window so the step spans the chart", () => {
    const series = toNavStepSeries(nav, { from: 100, to: 500 });
    expect(series.map((point) => point.time)).toEqual([100, 200, 400, 500]);
    expect(series[0]?.value).toBeCloseTo(1.0, 6);
    expect(series[series.length - 1]?.value).toBeCloseTo(1.1, 6);
  });

  it("does not pad beyond the values when they already cover the window", () => {
    const series = toNavStepSeries(nav, { from: 200, to: 400 });
    expect(series.map((point) => point.time)).toEqual([200, 400]);
  });

  it("returns nothing when there is no NAV history", () => {
    expect(toNavStepSeries([], { from: 0, to: 100 })).toEqual([]);
  });
});

describe("referenceLines", () => {
  it("labels the floor with its coverage and keeps parity distinct", () => {
    const lines = referenceLines({ floorPrice: "0.298300", floorCovered: false, parity: "1.000000" });
    expect(lines).toEqual([
      { price: 0.2983, title: "Floor · not covered" },
      { price: 1, title: "Parity · schedule target" },
    ]);
  });

  it("omits a line whose value is null", () => {
    expect(referenceLines({ floorPrice: null, floorCovered: true, parity: null })).toEqual([]);
  });
});
