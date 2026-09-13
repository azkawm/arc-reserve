import { describe, expect, it } from "vitest";
import { priceToTick, tickToPrice } from "@/lib/ticks";

describe("tick <-> price", () => {
  it("gives the same human price for tick t under one ordering and -t under the other", () => {
    const tick = -275420;
    expect(tickToPrice(tick, true)).toBeCloseTo(tickToPrice(-tick, false), 6);
  });

  it("round-trips through priceToTick under both orderings", () => {
    for (const tick of [-275420, -276325, -100000]) {
      for (const assetIsToken0 of [true, false]) {
        const price = tickToPrice(tick, assetIsToken0);
        expect(priceToTick(price, assetIsToken0)).toBeCloseTo(tick, 2);
      }
    }
  });

  it("produces the expected price near the live tick", () => {
    // The live pool sits around tick -275420, which reads as about 1.0946 mUSD.
    expect(tickToPrice(-275420, true)).toBeCloseTo(1.0946, 2);
  });
});
