import { liquidityPositions, marketPipeline, priceHistory, solarAsset } from "@/lib/data";
import type {
  ActivityItem,
  AssetDetail,
  AssetListItem,
  AssetMetrics,
  Candles,
  Envelope,
  NavPoint,
  Positions,
  Redemptions,
  Revenue,
} from "@/lib/api";
import { fixtureEnvelope } from "@/lib/api";

/**
 * The fixture adapter.
 *
 * `data.ts` predates the API and is shaped for JSX, not for the contract. These functions
 * translate it into the same shapes the backend returns, so a component reads one type
 * regardless of where the data came from and decides what to render from `meta.provenance`
 * alone — never from a "are we in demo mode" branch scattered through the tree.
 *
 * This is only reached when no `VITE_API_URL` is configured. A *failed* request against
 * a configured backend never lands here (D-019): that is an error state.
 */

const toDecimal = (value: number, decimals: number): string => value.toFixed(decimals);

export function fixtureAssets(): Envelope<AssetListItem[]> {
  return fixtureEnvelope(
    marketPipeline.map((entry, index): AssetListItem => {
      const live = entry.status === "Live";
      return {
        assetId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
        slug: entry.href?.replace("/assets/", "") ?? entry.symbol.toLowerCase(),
        name: entry.name,
        symbol: entry.symbol,
        category: entry.category,
        status: live ? "Active" : "Pending",
        issuer: `0x${"0".repeat(40)}`,
        spot: live ? { value: toDecimal(solarAsset.spot, 6), provenance: "mock" } : null,
        floor: live ? toDecimal(solarAsset.floor, 6) : null,
        reserve: live ? toDecimal(solarAsset.reserve, 6) : null,
        change24h: live ? "1.80" : null,
        contracts: null,
      };
    }),
  );
}

export function fixtureCandles(): Envelope<Candles> {
  return fixtureEnvelope({
    interval: 3600,
    source: "mock",
    candles: priceHistory.map((point, index) => ({
      // The fixture carried clock labels ("09:00"); the contract is unix seconds, so the
      // adapter has to invent a timeline rather than pass a string through.
      timestamp: Math.floor(Date.now() / 1000) - (priceHistory.length - 1 - index) * 3600,
      open: toDecimal(point.open, 6),
      high: toDecimal(point.high, 6),
      low: toDecimal(point.low, 6),
      close: toDecimal(point.close, 6),
      volumeAsset: "0.000000000000000000",
      volumeStable: "0.000000",
      tradeCount: 1,
      finalized: index < priceHistory.length - 1,
    })),
  });
}

export function fixturePositions(): Envelope<Positions> {
  const kinds = {
    floor: "ReserveFloor",
    anchor: "Anchor",
    discovery: "Discovery",
    intermediary: "Intermediary",
  } as const;

  return fixtureEnvelope({
    assetIsToken0: false,
    tickSpacing: 60,
    currentTick: null,
    positions: liquidityPositions.map((position) => {
      const [lower, upper] = position.range.replace(" mUSD", "").split(" - ");
      return {
        kind: kinds[position.id],
        configured: true,
        tickLower: 0,
        tickUpper: 0,
        priceLower: lower === undefined ? null : toDecimal(Number(lower), 6),
        priceUpper: upper === undefined ? null : toDecimal(Number(upper), 6),
        // The fixture's "7,200 mUSD" was never liquidity — real positions expose a raw
        // uint128 that cannot be converted to an amount without the curve.
        liquidity: "0",
        lastAction: null,
      };
    }),
  });
}

/** The one asset the demo shows, as the fixture adapter's own detail row. */
export function fixtureAssetDetail(): Envelope<AssetDetail> {
  return fixtureEnvelope({
    assetId: `0x${"1".padStart(64, "0")}`,
    slug: solarAsset.slug,
    name: solarAsset.name,
    symbol: solarAsset.symbol,
    category: solarAsset.category,
    status: "Active",
    issuer: `0x${"0".repeat(40)}`,
    metadataURI: solarAsset.metadataUri,
    metadataHash: `0x${"0".repeat(64)}`,
    maturity: Math.floor(Date.now() / 1000) + 3 * 365 * 86_400,
    submittedAt: Math.floor(Date.now() / 1000) - 30 * 86_400,
    termsHash: null,
    contracts: null,
  });
}

/**
 * Metrics fixture for the SOLAR01 desk. Every value is labelled `mock` by the envelope, so no
 * panel can present it as live (D-019); it exists so the fixture/e2e mode renders the full desk.
 */
export function fixtureMetrics(): Envelope<AssetMetrics> {
  const now = Math.floor(Date.now() / 1000);
  return fixtureEnvelope({
    nav: {
      value: toDecimal(solarAsset.nav, 6),
      raw: "1000000",
      timestamp: now - 3_600,
      stale: false,
      staleAfterSeconds: 172_800,
      expiresAt: now + 169_200,
    },
    marketStatus: "ready",
    spot: {
      value: { value: toDecimal(solarAsset.spot, 6), raw: "1018000", sourceBlock: 1 },
      provenance: "mock",
    },
    floorReference: { value: toDecimal(solarAsset.floor, 6), raw: "820000", formula: "published reference" },
    redemptionPrice: {
      normal: toDecimal(solarAsset.redemption, 6),
      maturity: null,
      emergency: null,
    },
    reserve: {
      redemptionReserve: toDecimal(solarAsset.reserve, 6),
      marketMakingAllocation: "0.000000",
      assetRevenue: "0.000000",
      issuerProceeds: "0.000000",
      protocolFees: "0.000000",
      totalAccounted: toDecimal(solarAsset.reserve, 6),
      vaultBalance: toDecimal(solarAsset.reserve, 6),
      reserveRatioBps: "24600",
      minimumReserveRatioBps: 2000,
      minimumRequiredReserve: "1000.000000",
      isSolvent: true,
      availableRedemptionLiquidity: toDecimal(solarAsset.reserve, 6),
    },
    reserveSchedule: {
      startBacking: "0.300000",
      targetBacking: "1.000000",
      targetBackingNow: "0.400000",
      currentBacking: "0.640000",
      startTime: now - 180 * 86_400,
      maturity: now + 3 * 365 * 86_400,
      graceSeconds: 2_592_000,
      behindSchedule: false,
      inEnforcedShortfall: false,
      shortfallStartedAt: null,
    },
    supply: {
      maximum: toDecimal(solarAsset.maximumSupply, 18),
      issued: toDecimal(solarAsset.issuedSupply, 18),
      excluded: toDecimal(solarAsset.companyVesting, 18),
      investor: toDecimal(solarAsset.circulating, 18),
      eligibleCirculating: toDecimal(solarAsset.circulating, 18),
      headroom: toDecimal(solarAsset.issuanceHeadroom, 18),
      vesting: null,
    },
    offering: {
      price: "1.000000",
      raised: "84500.000000",
      cap: "100000.000000",
      sold: "84500.000000000000000000",
      inventory: toDecimal(15_500, 18),
      walletLimit: "50000.000000",
      minimumPurchase: "1.000000",
      startsAt: now - 30 * 86_400,
      endsAt: now + 4 * 86_400,
      open: true,
    },
    redemption: {
      periodStartedAt: now - 3_600,
      periodDuration: 86_400,
      redeemedThisPeriod: "0.000000000000000000",
      periodLimit: "25000.000000000000000000",
      totalRedeemedTokens: "0",
      totalStablecoinPaid: "0",
    },
    floor: {
      controller: `0x${"0".repeat(40)}`,
      tick: -300_000,
      price: toDecimal(solarAsset.floor, 6),
      covered: true,
      canLevelUp: true,
      nextTick: -299_940,
      cooldownSeconds: 5,
      lastLevelUpAt: now - 600,
    },
    maturity: now + 3 * 365 * 86_400,
    safety: {
      failure: "None",
      checkedWithCooldown: true,
      lastRebalanceAt: now - 3_600,
      cooldownSeconds: 5,
    },
  });
}

export function fixtureNavHistory(): Envelope<NavPoint[]> {
  const now = Math.floor(Date.now() / 1000);
  return fixtureEnvelope(
    priceHistory.map((point, index) => ({
      timestamp: now - (priceHistory.length - 1 - index) * 3_600,
      nav: toDecimal(point.nav, 6),
      previousNav: index === 0 ? toDecimal(point.nav, 6) : toDecimal(priceHistory[index - 1]!.nav, 6),
      txHash: `0x${"0".repeat(64)}`,
    })),
  );
}

export function fixtureActivity(): Envelope<ActivityItem[]> {
  return fixtureEnvelope([]);
}

export function fixtureRevenue(): Envelope<Revenue> {
  return fixtureEnvelope({
    totalDeposited: toDecimal(solarAsset.annualRevenue, 6),
    totalHolder: toDecimal(solarAsset.holderRevenue, 6),
    totalReserve: "0.000000",
    totalOperator: "0.000000",
    totalProtocol: "0.000000",
    totalClaimed: "0.000000",
    operatorAccrued: "0.000000",
    deposits: [],
  });
}

export function fixtureRedemptions(): Envelope<Redemptions> {
  return fixtureEnvelope({
    totalRedeemedTokens: "0",
    totalStablecoinPaid: "0",
    emergencySettlementPrice: toDecimal(solarAsset.redemption, 6),
    currentPeriod: {
      startedAt: Math.floor(Date.now() / 1000) - 3_600,
      duration: 86_400,
      redeemed: "0.000000000000000000",
      limit: "25000.000000000000000000",
      remaining: "25000.000000000000000000",
    },
    history: [],
  });
}
