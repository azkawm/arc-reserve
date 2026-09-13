import { describe, expect, it } from "vitest";
import type { AssetListItem, AssetMetrics, SwapQuote } from "@/lib/api";

/**
 * Contract-shape fixtures.
 *
 * These are typed literals, so a backend shape change that the frontend types do not follow fails
 * `tsc` here before it can fail a demo. They stand in for responses recorded from a running
 * `:4000`; when the backend is available, replace the values with captured responses (same types)
 * and add one file per route per chain (guide §E.2). The live values below are from
 * PRODUCT_KNOWLEDGE §1, 2026-09-13.
 */

const assets: AssetListItem[] = [
  {
    assetId: "0xda699bc78ef95f03df4596582f7a3a29f8b95d5984d8b8fa279df0747959f4c4",
    slug: "solar-indonesia-01",
    name: "Solar Indonesia 01",
    symbol: "SOLAR01",
    category: "Renewable energy",
    status: "Active",
    issuer: "0x0000000000000000000000000000000000000001",
    spot: { value: "1.0946", provenance: "onchain" },
    floor: "0.2983",
    reserve: "21799.999998",
    change24h: "1.80",
    contracts: {
      token: "0x2a92796fA4eB95C1F5B55EbeD403bB42e9026827",
      vault: "0x1F5238616aabdCD588dBE07f6d938a998C9428c8",
      offering: "0x753B1e50Fd3Db319DC4Aa03a7602478ef6392dD4",
      marketManager: "0xaA6C6A4CE2d5cA6e58e537dE3823828cb86478c2",
      revenueDistributor: "0xC4C11E4593C86B9Ab10bcB5ffaD279944E18ea8A",
      redemptionController: "0xe8A6A3e1995CA92C3c9427499F4Ee9134B5071C0",
      pool: "0xcb77d1068A3Cc3E846Fdaff14B80476f773c6d31",
      floorController: "0x34c1Ac45EfB6Edc68d9Afc248797D3B5b21dBBa4",
    },
  },
];

const metrics: AssetMetrics = {
  nav: {
    value: "1.000000",
    raw: "1000000",
    timestamp: 1_757_000_000,
    stale: false,
    staleAfterSeconds: 172_800,
    expiresAt: 1_757_172_800,
  },
  marketStatus: "ready",
  spot: { value: { value: "1.0946", raw: "1094600", sourceBlock: 9_000_000 }, provenance: "onchain" },
  floorReference: { value: "0.2983", raw: "298300", formula: "published reference" },
  redemptionPrice: { normal: "1.000000", maturity: null, emergency: null },
  reserve: {
    redemptionReserve: "21799.999998",
    marketMakingAllocation: "0.000000",
    assetRevenue: "0.000000",
    issuerProceeds: "0.000000",
    protocolFees: "0.000000",
    totalAccounted: "21799.999998",
    vaultBalance: "21799.999998",
    reserveRatioBps: "43600",
    minimumReserveRatioBps: 2000,
    minimumRequiredReserve: "1000.000000",
    isSolvent: true,
    availableRedemptionLiquidity: "21799.999998",
  },
  reserveSchedule: {
    startBacking: "0.300000",
    targetBacking: "1.000000",
    targetBackingNow: "0.40",
    currentBacking: "4.359999",
    startTime: 1_700_000_000,
    maturity: 1_794_000_000,
    graceSeconds: 2_592_000,
    behindSchedule: false,
    inEnforcedShortfall: false,
    shortfallStartedAt: null,
  },
  supply: {
    maximum: "100000.000000000000000000",
    issued: "5000.000000000000000000",
    excluded: "0",
    investor: "5000.000000000000000000",
    eligibleCirculating: "5000.000000000000000000",
    headroom: "95000.000000000000000000",
    vesting: null,
  },
  offering: {
    price: "1.000000",
    raised: "0.000000",
    cap: "80000.000000",
    sold: "0.000000",
    inventory: "80000.000000000000000000",
    walletLimit: "50000.000000",
    minimumPurchase: "1.000000",
    startsAt: 1_700_000_000,
    endsAt: 1_794_000_000,
    open: true,
  },
  redemption: {
    periodStartedAt: 1_757_000_000,
    periodDuration: 86_400,
    redeemedThisPeriod: "0.000000000000000000",
    periodLimit: "25000.000000000000000000",
    totalRedeemedTokens: "0",
    totalStablecoinPaid: "0",
  },
  floor: {
    controller: "0x34c1Ac45EfB6Edc68d9Afc248797D3B5b21dBBa4",
    tick: -275_940,
    price: "0.2983",
    covered: true,
    canLevelUp: false,
    nextTick: -275_880,
    cooldownSeconds: 5,
    lastLevelUpAt: 1_757_000_000,
  },
  maturity: 1_794_000_000,
  safety: { failure: "None", checkedWithCooldown: true, lastRebalanceAt: 1_757_000_000, cooldownSeconds: 5 },
};

const quote: SwapQuote = {
  tokenIn: "0x48D8dad3cF46F99CEc63466cD9AF8F8f56aa301C",
  tokenOut: "0x2a92796fA4eB95C1F5B55EbeD403bB42e9026827",
  amountIn: "10.000000",
  spent: "10.000000",
  amountOut: "9.099",
  partialFill: false,
};

describe("contract-shape fixtures", () => {
  it("parse against the frontend types", () => {
    expect(assets[0]?.symbol).toBe("SOLAR01");
    expect(metrics.nav.value).toBe("1.000000");
    expect(metrics.nav.expiresAt).toBe(1_757_172_800);
    expect(metrics.floor?.covered).toBe(true);
    expect(metrics.redemptionPrice.normal).toBe("1.000000");
    expect(quote.partialFill).toBe(false);
  });

  it("carries no twap field", () => {
    expect("twap" in metrics).toBe(false);
  });
});
