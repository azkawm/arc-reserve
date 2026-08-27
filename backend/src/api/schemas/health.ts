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
  /** Rows the projector flagged rather than overwrote. Non-zero means degraded. */
  anomalies: z.object({ open: z.number().int().nonnegative() }),
  /** Whether this process is permitted to serve synthetic market data at all (D-019). */
  allowMockMarketData: z.boolean(),
  staleAfterSeconds: z.number().int().positive(),
});

export type HealthPayload = z.infer<typeof healthSchema>;
