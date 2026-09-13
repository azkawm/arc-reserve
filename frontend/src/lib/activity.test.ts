import { describe, expect, it } from "vitest";
import type { ActivityItem } from "@/lib/api";
import { toSwapRows } from "@/lib/activity";
import { explorerTxUrl } from "@/lib/chains";

const assetToken = "0x2a92796fA4eB95C1F5B55EbeD403bB42e9026827";
const stable = "0x48D8dad3cF46F99CEc63466cD9AF8F8f56aa301C";
const context = { tokenAddress: assetToken, stableAddress: stable, symbol: "SOLAR01" };

function swap(overrides: Partial<ActivityItem["summary"]>): ActivityItem {
  return {
    id: "0xtx:0",
    timestamp: 1_700_000_000,
    blockNumber: 1,
    txHash: "0xabc",
    logIndex: 0,
    type: "Swap",
    actor: "0xtrader",
    summary: {
      tokenIn: stable,
      amountRequested: "10000000",
      amountSpent: "10000000",
      amountOut: "9099485261052763284",
      ...overrides,
    },
  };
}

describe("toSwapRows", () => {
  it("classifies a stable-in swap as a Buy and uses pool decimals", () => {
    const [row] = toSwapRows([swap({})], context);
    expect(row?.kind).toBe("Buy");
    expect(row?.symbolIn).toBe("mUSD");
    expect(row?.amountIn).toBe("10");
    expect(row?.symbolOut).toBe("SOLAR01");
    expect(row?.amountOut).toBe("9.099485261052763284");
    expect(row?.partial).toBe(false);
  });

  it("classifies an asset-in swap as a Sell", () => {
    const sell = swap({
      tokenIn: assetToken,
      amountSpent: "5000000000000000000",
      amountOut: "5474655",
      amountRequested: "5000000000000000000",
    });
    const [row] = toSwapRows([sell], context);
    expect(row?.kind).toBe("Sell");
    expect(row?.symbolIn).toBe("SOLAR01");
    expect(row?.amountIn).toBe("5");
    expect(row?.symbolOut).toBe("mUSD");
    expect(row?.amountOut).toBe("5.474655");
  });

  it("flags a partial fill when amountRequested exceeds amountSpent", () => {
    const [row] = toSwapRows([swap({ amountRequested: "100000000", amountSpent: "10000000" })], context);
    expect(row?.partial).toBe(true);
  });

  it("turns a primary Purchase into a Buy row from its human-unit amounts", () => {
    const purchase: ActivityItem = {
      id: "0xbuy:0",
      timestamp: 1_700_000_100,
      blockNumber: 2,
      txHash: "0xdef",
      logIndex: 0,
      type: "Purchase",
      actor: "0xbuyer",
      summary: { stablecoinAmount: "250.000000", tokenAmount: "250.000000000000000000" },
    };
    const rows = toSwapRows([purchase], context);
    expect(rows[0]?.kind).toBe("Buy");
    expect(rows[0]?.amountIn).toBe("250.000000");
    expect(rows[0]?.symbolOut).toBe("SOLAR01");
  });

  it("ignores unrelated activity and sorts newest first", () => {
    const earlier = swap({});
    const later = { ...swap({}), id: "0x2:0", timestamp: 1_700_000_500, txHash: "0x2" };
    const nav: ActivityItem = {
      id: "0xnav:0",
      timestamp: 1_700_000_200,
      blockNumber: 3,
      txHash: "0xnav",
      logIndex: 0,
      type: "NAVUpdate",
      actor: null,
      summary: {},
    };
    const rows = toSwapRows([earlier, later, nav], context);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.txHash).toBe("0x2");
  });
});

describe("explorerTxUrl", () => {
  it("links each live chain to its own explorer and returns null without one", () => {
    expect(explorerTxUrl(296, "0xabc")).toBe("https://hashscan.io/testnet/transaction/0xabc");
    expect(explorerTxUrl(5042002, "0xabc")).toBe("https://testnet.arcscan.app/tx/0xabc");
    expect(explorerTxUrl(31337, "0xabc")).toBeNull();
  });
});
