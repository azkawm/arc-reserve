import { z } from 'zod';

/**
 * `GET /v1/health` payload. Reports everything BACKEND_INDEXER.md section 14 asks for, and
 * nothing that could leak a credential: no connection string, no RPC URL with a key in it.
 */

export const healthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const cursorHealthSchema = z.object({
  chainId: z.number().int(),
  worker: z.string(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: z.string(),
  blockTimestamp: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lagBlocks: z.number().int().nonnegative(),
  lagSeconds: z.number().int(),
  reorgDepth: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export const chainSummarySchema = z.object({
  chainId: z.number().int(),
  name: z.string(),
  confirmations: z.number().int().nonnegative(),
  registry: z.string(),
  factory: z.string(),
  stablecoin: z.string(),
  /** True for the chain this process indexes; the API serves every chain in the database. */
  indexedByThisProcess: z.boolean(),
});

export const healthSchema = z.object({
  status: healthStatusSchema,
  service: z.object({
    name: z.literal('arcreserve-backend'),
    version: z.string(),
    nodeEnv: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    milestone: z.string(),
  }),
  chain: z.object({
    configuredChainId: z.number().int(),
    rpcChainId: z.number().int().nullable(),
    name: z.string(),
    latestBlock: z.number().int().nonnegative().nullable(),
    rpcOk: z.boolean(),
    rpcLatencyMs: z.number().int().nonnegative().nullable(),
    error: z.string().nullable(),
  }),
  database: z.object({
    connected: z.boolean(),
    latencyMs: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }),
  /** One row per worker per chain. Empty until the indexer runs (Milestone B). */
  indexers: z.array(cursorHealthSchema),
  chains: z.array(chainSummarySchema),
  watchedContracts: z.number().int().nonnegative(),
  /**
   * Rows the projector flagged rather than overwrote. `open` counts every chain in the shared
   * database; `indexedChain` counts only the chain this process indexes, and only that one moves
   * `status` to degraded. A chain listed in `byChain` with open rows is still worth showing — some
   * other process answers for it.
   */
  anomalies: z.object({
    open: z.number().int().nonnegative(),
    indexedChain: z.number().int().nonnegative(),
    byChain: z.array(
      z.object({ chainId: z.number().int(), open: z.number().int().nonnegative() }),
    ),
  }),
  /**
   * Per-asset exposure on the indexed chain. Since D-039 nothing on-chain reads `isNAVStale`,
   * and normal-mode redemption prices at `min(nav, backing)` with no par cap — so a stale NAV
   * that is too HIGH overpays redeemers out of the shared reserve, and this is the only control
   * that exists. `navExpiresAt` is the point of it: `navStale` says the horse has gone, the
   * deadline lets someone republish before it does.
   */
  risks: z.array(
    z.object({
      assetId: z.string(),
      navExpiresAt: z.number().int().nullable(),
      navStale: z.boolean(),
      /**
       * Last indexed trade against NAV, in basis points, signed. Derived from the read model
       * rather than a live pool read: health is polled after every confirmed transaction, and
       * fanning out an RPC call per asset per poll is how a rate-limited endpoint starts
       * refusing the reads that matter. Null when the asset has never traded.
       */
      lastPriceVsNavBps: z.number().int().nullable(),
    }),
  ),
  /** Whether this process is permitted to serve synthetic market data at all (D-019). */
  allowMockMarketData: z.boolean(),
  staleAfterSeconds: z.number().int().positive(),
});

export type HealthPayload = z.infer<typeof healthSchema>;
