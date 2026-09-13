import { describe, expect, it } from "vitest";
import { RESERVED_SAFETY_FAILURES, SAFETY_FAILURE, safetyFailureName } from "@/lib/safety";

describe("safety failure map", () => {
  it("is the nine backend codes, in order", () => {
    expect([...SAFETY_FAILURE]).toEqual([
      "None",
      "Paused",
      "AssetNotActive",
      "Matured",
      "StaleNAV",
      "SpotTwapDeviation",
      "MarketNAVDeviation",
      "ReserveBelowMinimum",
      "Cooldown",
    ]);
  });

  it("keeps 4/5/6 reserved rather than removing them, so 7 and 8 do not shift", () => {
    expect([...RESERVED_SAFETY_FAILURES].sort((a, b) => a - b)).toEqual([4, 5, 6]);
    expect(SAFETY_FAILURE[7]).toBe("ReserveBelowMinimum");
    expect(SAFETY_FAILURE[8]).toBe("Cooldown");
  });

  it("names an out-of-range code instead of throwing", () => {
    expect(safetyFailureName(99)).toBe("Unknown(99)");
  });
});
