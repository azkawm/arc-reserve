import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent, formatPrice } from "@/lib/format";

/**
 * `null` is not `0` (INTEGRATION_GUIDE rule 3). A nullable field must render a dash, because a
 * zero is a plausible number and a dash is not.
 */
describe("nullable values render a dash, never zero", () => {
  it("formats null and undefined as a dash", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(undefined)).toBe("—");
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  it("still renders a real zero as zero", () => {
    expect(formatAmount("0")).toBe("0");
    expect(formatPercent("0")).toBe("+0%");
  });
});
