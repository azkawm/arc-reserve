/**
 * The backend client.
 *
 * Implements the envelope in `docs/stacks/BACKEND_TO_FRONTEND.md` §1, and one rule that the
 * whole provenance story rests on (D-019):
 *
 *   **Fixture mode is a configured mode, never a fallback.**
 *
 * With no `VITE_API_URL` the app runs on `data.ts` and every panel says `Mock`. With an
 * API URL configured, a failed request is an *error state* — it never quietly becomes a
 * fixture. Those two behaviours look similar in a screenshot and are completely different
 * claims about what the user is looking at.
 *
 * The response types below mirror `backend/src/api/schemas/` field for field. When that schema
 * changes, this file changes with it — a shape the API no longer sends must not keep compiling.
 */

export type Provenance = "onchain" | "derived" | "mock";

export interface ResponseMeta {
  chainId: number;
  indexedBlock: number;
  indexedBlockHash: string | null;
  asOf: number | null;
  provenance: Provenance;
  stale: boolean;
  lagBlocks: number;
}

export interface Envelope<T> {
  data: T;
  meta: ResponseMeta;
}

/**
 * Backend codes plus two the client owns: `NETWORK` (the request never reached a server) and
 * `CHAIN_MISMATCH` (the response arrived for a chain other than the one requested).
 */
export type ApiErrorCode =
  | "ASSET_NOT_FOUND"
  | "INDEXER_BEHIND"
  | "MOCK_DISABLED"
  | "BAD_REQUEST"
  | "CHAIN_UNAVAILABLE"
  | "QUOTE_UNAVAILABLE"
  | "CHAIN_MISMATCH"
  | "INTERNAL"
  | "NETWORK";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Backend `error.details`, when present (for example a swap quote's `revertedWith`). */
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

/** True when no backend is configured, so the app is deliberately running on fixtures. */
export const fixtureMode = apiBaseUrl === "";

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<Envelope<T>> {
  if (fixtureMode) {
    throw new ApiError("NETWORK", "no VITE_API_URL configured");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      signal: signal ?? null,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiError("NETWORK", `cannot reach the backend: ${(cause as Error).message}`);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      body !== null && typeof body === "object" && "error" in body
        ? (body as { error: { code?: string; message?: string; details?: unknown } }).error
        : null;
    throw new ApiError(
      (error?.code as ApiErrorCode) ?? "INTERNAL",
      error?.message ?? `request failed with ${response.status}`,
      response.status,
      error?.details,
    );
  }

  if (body === null || typeof body !== "object" || !("data" in body) || !("meta" in body)) {
    throw new ApiError("INTERNAL", "response did not carry the { data, meta } envelope");
  }

  return body as Envelope<T>;
}

/**
 * Wrap a local fixture so it travels through the same shape as a real response. Components
 * therefore never branch on "is this mock" — they read `meta.provenance` and render a badge.
 */
export function fixtureEnvelope<T>(data: T): Envelope<T> {
  return {
    data,
    meta: {
      chainId: 31337,
      indexedBlock: 0,
      indexedBlockHash: null,
      asOf: null,
      provenance: "mock",
      stale: true,
      lagBlocks: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Response shapes — mirror backend/src/api/schemas/
// ---------------------------------------------------------------------------

export interface Provenanced<T> {
  value: T;
  provenance: Provenance;
}

export interface Contracts {
  token: string;
  vault: string;
  offering: string;
  marketManager: string;
  revenueDistributor: string;
  redemptionController: string;
  pool: string | null;
  floorController: string | null;
}

export type AssetStatus =
  | "Pending"
  | "Approved"
  | "Active"
  | "Suspended"
  | "Defaulted"
  | "Matured"
  | "Closed";

export interface AssetListItem {
  assetId: string;
  slug: string;
  name: string;
  symbol: string;
  category: string;
  status: AssetStatus;
  issuer: string;
  spot: Provenanced<string> | null;
  floor: string | null;
  reserve: string | null;
  change24h: string | null;
  contracts: Contracts | null;
}

export interface AssetDetail {
  assetId: string;
  slug: string;
  name: string;
  symbol: string;
  category: string;
  status: AssetStatus;
  issuer: string;
  metadataURI: string;
  metadataHash: string;
  maturity: number;
  submittedAt: number;
  termsHash: string | null;
  contracts: Contracts | null;
}

export interface Amount {
  value: string;
  raw: string;
}

/** `ready` — spot is live; `unavailable` — no pool or a failed price read; `warming_up` reserved. */
export type MarketStatus = "ready" | "warming_up" | "unavailable";

export interface AssetMetrics {
  nav: {
    value: string;
    raw: string;
    timestamp: number;
    stale: boolean;
    /** How long a published NAV stays valid, and when this one lapses. */
    staleAfterSeconds: number | null;
    expiresAt: number | null;
  };
  marketStatus: MarketStatus;
  spot: Provenanced<Amount & { sourceBlock: number }> | null;
  floorReference: Amount & { formula: string };
  redemptionPrice: { normal: string | null; maturity: string | null; emergency: string | null };
  reserve: {
    redemptionReserve: string;
    marketMakingAllocation: string;
    assetRevenue: string;
    issuerProceeds: string;
    protocolFees: string;
    totalAccounted: string;
    vaultBalance: string;
    reserveRatioBps: string | null;
    minimumReserveRatioBps: number;
    minimumRequiredReserve: string;
    isSolvent: boolean;
    availableRedemptionLiquidity: string;
  };
  reserveSchedule: {
    startBacking: string;
    targetBacking: string;
    targetBackingNow: string;
    currentBacking: string;
    startTime: number;
    maturity: number;
    graceSeconds: number;
    behindSchedule: boolean;
    inEnforcedShortfall: boolean;
    shortfallStartedAt: number | null;
  } | null;
  supply: {
    maximum: string;
    issued: string;
    excluded: string;
    investor: string;
    eligibleCirculating: string;
    headroom: string;
    vesting: {
      address: string;
      balance: string;
      released: string;
      start: number;
      end: number;
    } | null;
  };
  offering: {
    price: string;
    raised: string;
    cap: string;
    sold: string;
    inventory: string;
    walletLimit: string;
    minimumPurchase: string;
    startsAt: number;
    endsAt: number;
    open: boolean;
  };
  redemption: {
    periodStartedAt: number;
    periodDuration: number;
    redeemedThisPeriod: string;
    periodLimit: string;
    totalRedeemedTokens: string;
    totalStablecoinPaid: string;
  };
  /**
   * D-025. `covered` is deliberately inside this object: `isFloorCovered()` can go false with
   * no event and no state change, so the level must never be rendered without it.
   */
  floor: {
    controller: string;
    tick: number;
    price: string;
    covered: boolean;
    canLevelUp: boolean;
    nextTick: number | null;
    cooldownSeconds: number;
    lastLevelUpAt: number;
  } | null;
  maturity: number;
  safety: {
    failure: string;
    checkedWithCooldown: boolean;
    lastRebalanceAt: number;
    cooldownSeconds: number;
  } | null;
}

export type CandleInterval = 60 | 300 | 900 | 3600 | 14400 | 86400;

export interface Candle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeAsset: string;
  volumeStable: string;
  tradeCount: number;
  finalized: boolean;
}

export interface Candles {
  interval: CandleInterval;
  source: "canonical_swap" | "mock";
  candles: Candle[];
}

export interface NavPoint {
  timestamp: number;
  nav: string;
  previousNav: string;
  txHash: string;
}

export type PositionKind = "ReserveFloor" | "Anchor" | "Discovery" | "Intermediary";

export interface Positions {
  assetIsToken0: boolean;
  tickSpacing: number;
  currentTick: number | null;
  positions: Array<{
    kind: PositionKind;
    configured: boolean;
    tickLower: number;
    tickUpper: number;
    priceLower: string | null;
    priceUpper: string | null;
    liquidity: string;
    lastAction: { type: string; timestamp: number; txHash: string } | null;
  }>;
}

export interface ActivityItem {
  id: string;
  timestamp: number;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  type: string;
  /** Null when the event names no acting party; render a dash, not a guess. */
  actor: string | null;
  summary: Record<string, string | number>;
}

export interface AccountPosition {
  address: string;
  assetId: string;
  tokenBalance: string;
  yieldExcluded: boolean;
  issuerAllocation: boolean;
  yieldEligibleBalance: string;
  claimable: string;
  frozen: boolean;
  frozenTokens: string;
  complianceExempt: boolean;
  verified: boolean;
  identity: {
    country: number | null;
    investorClass: number | null;
    claimExpiresAt: number | null;
    registered: boolean;
  } | null;
  purchasedThisOffering: string;
  remainingWalletLimit: string;
  redemptionQuote: { mode: "Normal"; price: string; maxTokensThisPeriod: string } | null;
  history: ActivityItem[];
}

export interface RevenueDeposit {
  timestamp: number;
  txHash: string;
  periodId: string | null;
  reportHash: string | null;
  behindSchedule: boolean | null;
  gross: string;
  holder: string;
  reserve: string;
  operator: string;
  protocol: string;
}

export interface Revenue {
  totalDeposited: string;
  totalHolder: string;
  totalReserve: string;
  totalOperator: string;
  totalProtocol: string;
  totalClaimed: string;
  operatorAccrued: string;
  deposits: RevenueDeposit[];
}

export type RedemptionMode = "Normal" | "Maturity" | "Emergency";

export interface RedemptionHistoryItem {
  timestamp: number;
  txHash: string;
  holder: string;
  mode: RedemptionMode;
  tokenAmount: string;
  stablecoinAmount: string;
  nav: string;
  price: string;
}

export interface Redemptions {
  totalRedeemedTokens: string;
  totalStablecoinPaid: string;
  emergencySettlementPrice: string;
  currentPeriod: {
    startedAt: number;
    duration: number;
    redeemed: string;
    limit: string;
    remaining: string;
  };
  history: RedemptionHistoryItem[];
}

/**
 * A live `eth_call` of the real `swapExactInput`, never a projection. `spent` may be **less**
 * than `amountIn` on a partial fill (D-037): compute the price as `amountOut / spent`, never
 * `amountOut / amountIn`.
 */
export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  spent: string;
  amountOut: string;
  partialFill: boolean;
}

export interface HealthIndexer {
  chainId: number;
  worker: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  updatedAt: number;
  lagBlocks: number;
  lagSeconds: number;
  reorgDepth: number;
  lastError: string | null;
}

export interface HealthChainSummary {
  chainId: number;
  name: string;
  confirmations: number;
  registry: string;
  factory: string;
  stablecoin: string;
  indexedByThisProcess: boolean;
}

export interface HealthRisk {
  chainId: number;
  assetId: string;
  navExpiresAt: number | null;
  navStale: boolean;
  lastPriceVsNavBps: number | null;
}

export interface HealthPayload {
  status: "healthy" | "degraded" | "unhealthy";
  service: {
    name: "arcreserve-backend";
    version: string;
    nodeEnv: string;
    uptimeSeconds: number;
    milestone: string;
  };
  chain: {
    configuredChainId: number;
    rpcChainId: number | null;
    name: string;
    latestBlock: number | null;
    rpcOk: boolean;
    rpcLatencyMs: number | null;
    error: string | null;
  };
  database: { connected: boolean; latencyMs: number; error: string | null };
  indexers: HealthIndexer[];
  chains: HealthChainSummary[];
  watchedContracts: number;
  anomalies: {
    open: number;
    indexedChain: number;
    byChain: Array<{ chainId: number; open: number }>;
  };
  risks: HealthRisk[];
  riskCoverage: {
    computed: number[];
    notComputed: Array<{ chainId: number; reason: string }>;
  };
  rollbacks: Array<{
    chainId: number;
    count: number;
    last: {
      at: number;
      fromBlock: number;
      ancestorBlock: number;
      blocksDiscarded: number;
      logsDiscarded: number;
      cursorDeleted: boolean;
    };
  }>;
  pendingBackfills: Array<{ chainId: number; count: number }>;
  allowMockMarketData: boolean;
  staleAfterSeconds: number;
}
