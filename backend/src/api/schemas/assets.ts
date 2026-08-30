import { z } from 'zod';
import {
  addressSchema,
  amountSchema,
  assetStatusSchema,
  decimalString,
  hash32Schema,
  provenanced,
} from './common.js';

/**
 * The `/v1` response shapes, exactly as `docs/stacks/BACKEND_TO_FRONTEND.md` §3 promises them.
 * Every route parses its payload against the schema here before sending, so a shape the
 * frontend was promised cannot drift without a test going red.
 */

export const contractsSchema = z.object({
  token: addressSchema,
  vault: addressSchema,
  offering: addressSchema,
  marketManager: addressSchema,
  revenueDistributor: addressSchema,
  redemptionController: addressSchema,
  pool: addressSchema.nullable(),
});

// --- §3.1 GET /v1/assets ---------------------------------------------------

export const assetListItemSchema = z.object({
  assetId: hash32Schema,
  slug: z.string(),
  name: z.string(),
  symbol: z.string(),
  category: z.string(),
  status: assetStatusSchema,
  issuer: addressSchema,
  spot: provenanced(decimalString).nullable(),
  floor: decimalString.nullable(),
  reserve: decimalString.nullable(),
  change24h: decimalString.nullable(),
  contracts: contractsSchema.nullable(),
});

export const assetListSchema = z.array(assetListItemSchema);

// --- GET /v1/assets/:assetId ----------------------------------------------

export const assetDetailSchema = z.object({
  assetId: hash32Schema,
  slug: z.string(),
  name: z.string(),
  symbol: z.string(),
  category: z.string(),
  status: assetStatusSchema,
  issuer: addressSchema,
  metadataURI: z.string(),
  metadataHash: hash32Schema,
  maturity: z.number().int(),
  submittedAt: z.number().int(),
  contracts: contractsSchema.nullable(),
});

// --- §3.2 GET /v1/assets/:assetId/metrics ---------------------------------

const navSchema = z.object({
  value: decimalString,
  raw: z.string(),
  timestamp: z.number().int(),
  stale: z.boolean(),
});

export const metricsSchema = z.object({
  nav: navSchema,
  spot: provenanced(amountSchema.extend({ sourceBlock: z.number().int() })).nullable(),
  twap: provenanced(amountSchema.extend({ windowSeconds: z.number().int() })).nullable(),
  floorReference: amountSchema.extend({ formula: z.string() }),
  redemptionPrice: z.object({
    normal: decimalString.nullable(),
    maturity: decimalString.nullable(),
    emergency: decimalString.nullable(),
  }),
  reserve: z.object({
    redemptionReserve: decimalString,
    marketMakingAllocation: decimalString,
    assetRevenue: decimalString,
    issuerProceeds: decimalString,
    protocolFees: decimalString,
    totalAccounted: decimalString,
    vaultBalance: decimalString,
    reserveRatioBps: z.string().nullable(),
    minimumReserveRatioBps: z.number().int(),
    minimumRequiredReserve: decimalString,
    isSolvent: z.boolean(),
    availableRedemptionLiquidity: decimalString,
  }),
  /**
   * D-023, added 2026-08-30. Absent (null) on a deployment without a schedule.
   * `targetBacking` rises with time, so it is computed at read time, never projected.
   */
  reserveSchedule: z
    .object({
      startBacking: decimalString,
      targetBacking: decimalString,
      targetBackingNow: decimalString,
      currentBacking: decimalString,
      startTime: z.number().int(),
      maturity: z.number().int(),
      graceSeconds: z.number().int(),
      behindSchedule: z.boolean(),
      inEnforcedShortfall: z.boolean(),
      shortfallStartedAt: z.number().int().nullable(),
    })
    .nullable(),
  supply: z.object({
    maximum: decimalString,
    issued: decimalString,
    excluded: decimalString,
    investor: decimalString,
    eligibleCirculating: decimalString,
    headroom: decimalString,
    vesting: z
      .object({
        address: addressSchema,
        balance: decimalString,
        released: decimalString,
        start: z.number().int(),
        end: z.number().int(),
      })
      .nullable(),
  }),
  offering: z.object({
    price: decimalString,
    raised: decimalString,
    cap: decimalString,
    sold: decimalString,
    inventory: decimalString,
    walletLimit: decimalString,
    minimumPurchase: decimalString,
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    open: z.boolean(),
  }),
  redemption: z.object({
    periodStartedAt: z.number().int(),
    periodDuration: z.number().int(),
    redeemedThisPeriod: decimalString,
    periodLimit: decimalString,
    totalRedeemedTokens: decimalString,
    totalStablecoinPaid: decimalString,
  }),
  maturity: z.number().int(),
  safety: z
    .object({
      failure: z.string(),
      checkedWithCooldown: z.boolean(),
      lastRebalanceAt: z.number().int(),
      cooldownSeconds: z.number().int(),
    })
    .nullable(),
});

// --- §3.4 nav-history ------------------------------------------------------

export const navHistorySchema = z.array(
  z.object({
    timestamp: z.number().int(),
    nav: decimalString,
    previousNav: decimalString,
    txHash: hash32Schema,
  }),
);

// --- §3.5 positions --------------------------------------------------------

export const positionsSchema = z.object({
  assetIsToken0: z.boolean(),
  tickSpacing: z.number().int(),
  currentTick: z.number().int().nullable(),
  positions: z.array(
    z.object({
      kind: z.enum(['ReserveFloor', 'Anchor', 'Discovery', 'Intermediary']),
      configured: z.boolean(),
      tickLower: z.number().int(),
      tickUpper: z.number().int(),
      priceLower: decimalString.nullable(),
      priceUpper: decimalString.nullable(),
      /** Raw uint128. Deliberately not converted to token amounts. */
      liquidity: z.string(),
      lastAction: z
        .object({
          type: z.string(),
          timestamp: z.number().int(),
          txHash: hash32Schema,
        })
        .nullable(),
    }),
  ),
});

// --- §3.6 activity ---------------------------------------------------------

export const activityItemSchema = z.object({
  id: z.string(),
  timestamp: z.number().int(),
  blockNumber: z.number().int(),
  txHash: hash32Schema,
  logIndex: z.number().int(),
  type: z.string(),
  // Null when the event names no acting party (NAVUpdated, AssetStatusChanged, Rebalanced):
  // the actor is the transaction sender, which a log does not carry. CHANGED 2026-08-30.
  actor: addressSchema.nullable(),
  summary: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const activitySchema = z.array(activityItemSchema);

// --- §3.8 revenue ----------------------------------------------------------

export const revenueSchema = z.object({
  totalDeposited: decimalString,
  totalHolder: decimalString,
  totalReserve: decimalString,
  totalOperator: decimalString,
  totalProtocol: decimalString,
  totalClaimed: decimalString,
  operatorAccrued: decimalString,
  deposits: z.array(
    z.object({
      timestamp: z.number().int(),
      txHash: hash32Schema,
      periodId: z.string().nullable(),
      reportHash: hash32Schema.nullable(),
      behindSchedule: z.boolean().nullable(),
      gross: decimalString,
      holder: decimalString,
      reserve: decimalString,
      operator: decimalString,
      protocol: decimalString,
    }),
  ),
});

// --- §3.9 redemptions ------------------------------------------------------

export const redemptionsSchema = z.object({
  totalRedeemedTokens: decimalString,
  totalStablecoinPaid: decimalString,
  emergencySettlementPrice: decimalString,
  currentPeriod: z.object({
    startedAt: z.number().int(),
    duration: z.number().int(),
    redeemed: decimalString,
    limit: decimalString,
    remaining: decimalString,
  }),
  history: z.array(
    z.object({
      timestamp: z.number().int(),
      txHash: hash32Schema,
      holder: addressSchema,
      mode: z.enum(['Normal', 'Maturity', 'Emergency']),
      tokenAmount: decimalString,
      stablecoinAmount: decimalString,
      nav: decimalString,
      price: decimalString,
    }),
  ),
});

// --- §3.7 account ----------------------------------------------------------

export const accountPositionSchema = z.object({
  address: addressSchema,
  assetId: hash32Schema,
  tokenBalance: decimalString,
  yieldExcluded: z.boolean(),
  issuerAllocation: z.boolean(),
  yieldEligibleBalance: decimalString,
  claimable: decimalString,
  frozen: z.boolean(),
  frozenTokens: decimalString,
  complianceExempt: z.boolean(),
  /** Recomputed from the stored claim expiry at request time, never projected. */
  verified: z.boolean(),
  identity: z
    .object({
      country: z.number().int().nullable(),
      investorClass: z.number().int().nullable(),
      claimExpiresAt: z.number().int().nullable(),
      registered: z.boolean(),
    })
    .nullable(),
  purchasedThisOffering: decimalString,
  remainingWalletLimit: decimalString,
  redemptionQuote: z
    .object({
      mode: z.literal('Normal'),
      price: decimalString,
      maxTokensThisPeriod: decimalString,
    })
    .nullable(),
  history: activitySchema,
});

// --- §3.3 candles ----------------------------------------------------------

export const candlesSchema = z.object({
  interval: z.union([
    z.literal(60),
    z.literal(300),
    z.literal(900),
    z.literal(3600),
    z.literal(14400),
    z.literal(86400),
  ]),
  /** Never blended. A series is entirely canonical or entirely synthetic. */
  source: z.enum(['canonical_swap', 'mock']),
  candles: z.array(
    z.object({
      /** Bucket start, unix seconds — not a formatted clock time. */
      timestamp: z.number().int(),
      open: decimalString,
      high: decimalString,
      low: decimalString,
      close: decimalString,
      volumeAsset: decimalString,
      volumeStable: decimalString,
      tradeCount: z.number().int().nonnegative(),
      finalized: z.boolean(),
    }),
  ),
});
