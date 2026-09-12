import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatBps,
  formatCompact,
  formatPercent,
  formatPrice,
  shortAddress,
  trimDecimals,
} from "@/lib/format";

/**
 * These helpers render money. The API has already done the arithmetic in integers and handed
 * over exact decimal strings, so the only thing under test is that formatting never invents,
 * rounds, or loses a digit — a wrong display here is a wrong number in front of an investor.
 */
describe("trimDecimals", () => {
  it("truncates rather than rounds, so a value is never inflated", () => {
    expect(trimDecimals("1.019999", 3)).toBe("1.019");
    expect(trimDecimals("0.999999", 2)).toBe("0.99");
  });

  it("drops trailing zeros and the point when nothing is left", () => {
    expect(trimDecimals("24600.000000", 2)).toBe("24600");
    expect(trimDecimals("1.500000", 3)).toBe("1.5");
  });

  it("returns the whole part when no decimals are requested", () => {
    expect(trimDecimals("1.999", 0)).toBe("1");
  });
});

describe("formatAmount", () => {
  it("groups thousands and keeps the sign", () => {
    expect(formatAmount("24600.000000")).toBe("24,600");
    expect(formatAmount("1234567.890000")).toBe("1,234,567.89");
    expect(formatAmount("-2500.500000")).toBe("-2,500.5");
  });

  it("renders an em dash for an absent value instead of a zero", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(undefined)).toBe("—");
  });
});

describe("formatPrice", () => {
  it("always shows three decimals so a price column lines up", () => {
    expect(formatPrice("1.018000")).toBe("1.018");
    expect(formatPrice("0.820000")).toBe("0.820");
    expect(formatPrice("1")).toBe("1.000");
  });

  it("truncates below the third decimal, never rounding up", () => {
    expect(formatPrice("0.2983")).toBe("0.298");
  });

  it("distinguishes an absent price from a zero price", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice("0.000000")).toBe("0.000");
  });
});

describe("formatCompact", () => {
  it("abbreviates on integer digits only", () => {
    expect(formatCompact("24600.000000")).toBe("24.6k");
    expect(formatCompact("1500000.000000")).toBe("1.5M");
    expect(formatCompact("999.000000")).toBe("999");
  });
});

describe("formatBps", () => {
  it("converts basis points exactly, with two decimals", () => {
    expect(formatBps("2500")).toBe("25.00%");
    expect(formatBps(6500)).toBe("65.00%");
    expect(formatBps("5")).toBe("0.05%");
  });
});

describe("formatPercent", () => {
  it("signs a positive change explicitly", () => {
    expect(formatPercent("1.80")).toBe("+1.8%");
    expect(formatPercent("-2.50")).toBe("-2.5%");
  });
});

describe("shortAddress", () => {
  it("keeps both ends so two addresses stay distinguishable", () => {
    expect(shortAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe("0xf39F…2266");
    expect(shortAddress(null)).toBe("—");
  });
});
