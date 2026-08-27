import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import type { CursorPosition } from '../api/envelope.js';
import type { HealthPayload, HealthStatus } from '../api/schemas/health.js';

export interface HealthDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  startedAt: number;
  version: string;
}

interface ChainRow {
  chain_id: bigint;
  name: string;
  finality_confirmations: number;
  registry_address: string;
  factory_address: string;
  stablecoin_address: string;
}

interface CursorRow {
  chain_id: bigint;
  worker: string;
  block_number: bigint;
  block_hash: string;
  block_timestamp: bigint;
  reorg_depth: number;
  last_error: string | null;
  updated_at: Date;
}

export interface HealthResult {
  payload: HealthPayload;
  /** Cursor for this process's chain, used to build the response envelope. */
  cursor: CursorPosition | null;
  latestBlock: bigint | null;
}

/**
 * Gather operational state. Every probe is independent and failure-tolerant: a health
 * endpoint that throws when the database is down reports nothing at the moment it matters
 * most.
 */
export async function collectHealth(deps: HealthDeps): Promise<HealthResult> {
  const { config, db, client } = deps;
  const now = Math.floor(Date.now() / 1000);

  const [database, rpc] = await Promise.all([db.ping(), probeRpc(client)]);

  let chains: ChainRow[] = [];
  let cursors: CursorRow[] = [];
  let openAnomalies = 0;

  if (database.ok) {
    [chains, cursors, openAnomalies] = await Promise.all([
      db
        .query<ChainRow>(
          `SELECT chain_id, name, finality_confirmations, registry_address, factory_address,
                  stablecoin_address
             FROM chains ORDER BY chain_id`,
        )
        .then((r) => r.rows),
      db
        .query<CursorRow>(
          `SELECT chain_id, worker, block_number, block_hash, block_timestamp, reorg_depth,
                  last_error, updated_at
             FROM indexer_cursors ORDER BY chain_id, worker`,
        )
        .then((r) => r.rows),
      db
        .query<{ count: string }>(
          'SELECT count(*)::text AS count FROM projection_anomalies WHERE resolved = FALSE',
        )
        .then((r) => Number(r.rows[0]?.count ?? '0')),
    ]);
  }

  const indexers = cursors.map((row) => ({
    chainId: Number(row.chain_id),
    worker: row.worker,
    blockNumber: Number(row.block_number),
    blockHash: row.block_hash,
    blockTimestamp: Number(row.block_timestamp),
    updatedAt: Math.floor(row.updated_at.getTime() / 1000),
    lagBlocks:
      Number(row.chain_id) === config.CHAIN_ID && rpc.latestBlock !== null
        ? Math.max(0, Number(rpc.latestBlock - row.block_number))
        : 0,
    lagSeconds: now - Number(row.block_timestamp),
    reorgDepth: row.reorg_depth,
    lastError: row.last_error,
  }));

  const ownCursor = cursors.find(
    (row) => Number(row.chain_id) === config.CHAIN_ID && row.worker === 'arc-events',
  );

  const status = deriveStatus({
    databaseOk: database.ok,
    rpcOk: rpc.ok,
    openAnomalies,
    indexers,
    staleAfterSeconds: config.STALE_AFTER_SECONDS,
  });

  const payload: HealthPayload = {
    status,
    service: {
      name: 'arcreserve-backend',
      version: deps.version,
      nodeEnv: config.NODE_ENV,
      uptimeSeconds: Math.max(0, now - deps.startedAt),
      milestone: 'A - foundation',
    },
    chain: {
      configuredChainId: config.CHAIN_ID,
      rpcChainId: rpc.chainId,
      name: config.chainName,
      latestBlock: rpc.latestBlock === null ? null : Number(rpc.latestBlock),
      rpcOk: rpc.ok,
      rpcLatencyMs: rpc.latencyMs,
      error: rpc.error,
    },
    database: {
      connected: database.ok,
      latencyMs: database.latencyMs,
      error: database.error ?? null,
    },
    indexers,
    chains: chains.map((row) => ({
      chainId: Number(row.chain_id),
      name: row.name,
      confirmations: row.finality_confirmations,
      registry: row.registry_address,
      factory: row.factory_address,
      stablecoin: row.stablecoin_address,
      indexedByThisProcess: Number(row.chain_id) === config.CHAIN_ID,
    })),
    // Milestone A watches only the root contracts. Milestone B grows this set from
    // AssetSystemDeployed, so the count is a discovery signal, not a constant.
    watchedContracts: 3 + (config.addresses.companyVesting ? 1 : 0),
    anomalies: { open: openAnomalies },
    allowMockMarketData: config.ALLOW_MOCK_MARKET_DATA,
    staleAfterSeconds: config.STALE_AFTER_SECONDS,
  };

  const cursor: CursorPosition | null = ownCursor
    ? {
        blockNumber: ownCursor.block_number,
        blockHash: ownCursor.block_hash,
        blockTimestamp: ownCursor.block_timestamp,
      }
    : null;

  return { payload, cursor, latestBlock: rpc.latestBlock };
}

function deriveStatus(input: {
  databaseOk: boolean;
  rpcOk: boolean;
  openAnomalies: number;
  indexers: Array<{ lagSeconds: number; reorgDepth: number; lastError: string | null }>;
  staleAfterSeconds: number;
}): HealthStatus {
  // Without the database or the chain there is nothing truthful to serve.
  if (!input.databaseOk || !input.rpcOk) return 'unhealthy';

  const degraded =
    input.openAnomalies > 0 ||
    input.indexers.some(
      (indexer) =>
        indexer.lastError !== null ||
        indexer.reorgDepth > 0 ||
        indexer.lagSeconds > input.staleAfterSeconds,
    );

  return degraded ? 'degraded' : 'healthy';
}

async function probeRpc(client: ArcPublicClient): Promise<{
  ok: boolean;
  chainId: number | null;
  latestBlock: bigint | null;
  latencyMs: number | null;
  error: string | null;
}> {
  const startedAt = process.hrtime.bigint();
  try {
    const [chainId, latestBlock] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    return { ok: true, chainId, latestBlock, latencyMs, error: null };
  } catch (error) {
    const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    return {
      ok: false,
      chainId: null,
      latestBlock: null,
      latencyMs,
      error: (error as Error).message.split('\n')[0] ?? 'rpc error',
    };
  }
}
