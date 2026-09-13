import { describe, expect, it } from "vitest";
import { formatSwapSummary } from "@/lib/swap";

describe("swap summary", () => {
  it("uses the input token's decimals and shows no refund on a full fill", () => {
    const summary = formatSwapSummary({
      amountRequested: 10_000_000n, // 10 mUSD (6dp)
      amountSpent: 10_000_000n,
      amountOut: 9_100_000_000_000_000_000n, // 9.1 SOLAR01 (18dp)
      inDecimals: 6,
      outDecimals: 18,
      inSymbol: "mUSD",
      outSymbol: "SOLAR01",
    });
    expect(summary.refunded).toBe(false);
    expect(summary.refundText).toBeNull();
    expect(summary.text).toContain("10 mUSD");
    expect(summary.text).toContain("9.1 SOLAR01");
  });

  it("reports the refund only when amountSpent is below amountRequested", () => {
    const summary = formatSwapSummary({
      amountRequested: 100_000_000n, // 100 mUSD
      amountSpent: 60_000_000n, // 60 mUSD actually spent
      amountOut: 50_000_000_000_000_000_000n, // 50 SOLAR01
      inDecimals: 6,
      outDecimals: 18,
      inSymbol: "mUSD",
      outSymbol: "SOLAR01",
    });
    expect(summary.refunded).toBe(true);
    expect(summary.refundText).toBe("refunded 40 mUSD");
  });

  it("does not invent a refund when requested equals spent", () => {
    const summary = formatSwapSummary({
      amountRequested: 1n,
      amountSpent: 1n,
      amountOut: 1n,
      inDecimals: 18,
      outDecimals: 18,
      inSymbol: "SOLAR01",
      outSymbol: "mUSD",
    });
    expect(summary.refundText).toBeNull();
  });
});
