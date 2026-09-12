import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import type { CursorPosition } from '../api/envelope.js';
import type { Logger } from 'pino';
import { loadAbi } from '../chain/abis.js';
import type { HealthPayload, HealthStatus } from '../api/schemas/health.js';

export interface HealthDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  startedAt: number;
  version: string;
  logger?: Logger;
}

/**
 * How far the last trade may sit from NAV before it is worth saying out loud. Not read from the
 * contract: the manager's own deviation guard was removed in D-039, so there is no on-chain
 * number to inherit, and inventing agreement with one that no longer exists would be worse than
 * choosing a threshold openly.
 */
const PRICE_DIVERGENCE_WARN_BPS = 500;

/**
 * Warn once per transition, not once per poll. The frontend polls health after every confirmed
 * transaction, so logging on state rather than on edges would bury the signal in its own noise.
 */
const warned = new Map<string, { stale: boolean; divergence: boolean }>();

interface RiskRow {
  asset_id: string;
  current_nav: string | null;
  nav_updated_at: bigint | null;
  last_price: string | null;
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
  let anomalyRows: Array<{ chain_id: string; count: string }> = [];

  if (database.ok) {
    [chains, cursors, anomalyRows] = await Promise.all([
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
        .query<{ chain_id: string; count: string }>(
          `SELECT chain_id::text, count(*)::text AS count
             FROM projection_anomalies WHERE resolved = FALSE
            GROUP BY chain_id ORDER BY chain_id`,
        )
        .then((r) => r.rows),
    ]);
  }

  // Anomalies are reported for every chain in the shared database, because the API serves every
  // chain in it — but the verdict below is about THIS process, which indexes one. A service that
  // called itself degraded over a dev chain it does not index would be crying wolf, and a system
  // that shows red while it is fine teaches everyone to ignore red.
  const anomaliesByChain = anomalyRows.map((row) => ({
    chainId: Number(row.chain_id),
    open: Number(row.count),
  }));
  const openAnomalies = anomaliesByChain.reduce((total, row) => total + row.open, 0);
  const openOnIndexedChain =
    anomaliesByChain.find((row) => row.chainId === config.CHAIN_ID)?.open ?? 0;

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

  // Per-asset exposure, for the chain this process indexes. Everything here comes from the read
  // model except navStaleAfter, which is one registry-level call and the only RPC this adds.
  let risks: HealthPayload['risks'] = [];
  if (database.ok) {
    const navStaleAfter = await readNavStaleAfter(client, config.addresses.registry);
    const { rows } = await db.query<RiskRow>(
      `SELECT a.asset_id, a.current_nav::text, a.nav_updated_at,
              (SELECT c.close_raw::text
                 FROM candles c
                WHERE c.chain_id = a.chain_id AND c.pool = d.pool AND c.interval_seconds = 3600
                ORDER BY c.bucket_start DESC LIMIT 1) AS last_price
         FROM assets a
         LEFT JOIN asset_deployments d ON d.chain_id = a.chain_id AND d.asset_id = a.asset_id
        WHERE a.chain_id = $1
        ORDER BY a.asset_id`,
      [config.CHAIN_ID],
    );

    risks = rows.map((row) => {
      const expiresAt =
        navStaleAfter === null || row.nav_updated_at === null
          ? null
          : Number(row.nav_updated_at) + navStaleAfter;
      const navStale = expiresAt !== null && expiresAt <= now;

      const nav = row.current_nav === null ? 0n : BigInt(row.current_nav);
      const lastPriceVsNavBps =
        row.last_price === null || nav === 0n
          ? null
          : Number(((BigInt(row.last_price) - nav) * 10_000n) / nav);

      announce(deps.logger, row.asset_id, navStale, lastPriceVsNavBps, expiresAt);
      return { assetId: row.asset_id, navExpiresAt: expiresAt, navStale, lastPriceVsNavBps };
    });
  }

  // Durable rollback history, per chain. Read for every chain in the database, like anomalies,
  // because the API serves them all; unlike anomalies it never feeds the verdict below.
  let rollbacks: HealthPayload['rollbacks'] = [];
  if (database.ok) {
    const { rows } = await db.query<{
      chain_id: string;
      count: string;
      at: Date;
      from_block: string;
      ancestor_block: string;
      blocks_discarded: number;
      logs_discarded: number;
      cursor_deleted: boolean;
    }>(
      `SELECT c.chain_id::text, c.count::text, r.rolled_back_at AS at, r.from_block::text,
              r.ancestor_block::text, r.blocks_discarded, r.logs_discarded, r.cursor_deleted
         FROM (SELECT chain_id, count(*) AS count FROM indexer_rollbacks GROUP BY chain_id) c
         JOIN LATERAL (
              SELECT * FROM indexer_rollbacks x
               WHERE x.chain_id = c.chain_id
               ORDER BY x.rolled_back_at DESC, x.id DESC
               LIMIT 1
         ) r ON TRUE
        ORDER BY c.chain_id`,
    );
    rollbacks = rows.map((row) => ({
      chainId: Number(row.chain_id),
      count: Number(row.count),
      last: {
        at: Math.floor(row.at.getTime() / 1000),
        fromBlock: Number(row.from_block),
        ancestorBlock: Number(row.ancestor_block),
        blocksDiscarded: row.blocks_discarded,
        logsDiscarded: row.logs_discarded,
        cursorDeleted: row.cursor_deleted,
      },
    }));
  }

  const status = deriveStatus({
    databaseOk: database.ok,
    rpcOk: rpc.ok,
    openAnomalies: openOnIndexedChain,
    now,
    // Same reasoning: another chain's cursor being stale or errored is another process's
    // problem. This one answers for the chain it indexes.
    indexers: indexers.filter((indexer) => indexer.chainId === config.CHAIN_ID),
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
    anomalies: { open: openAnomalies, indexedChain: openOnIndexedChain, byChain: anomaliesByChain },
    risks,
    rollbacks,
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
  now: number;
  indexers: Array<{
    lagBlocks: number;
    updatedAt: number;
    reorgDepth: number;
    lastError: string | null;
  }>;
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
        // Behind the chain, and not catching up. Deliberately not "the newest block is old":
        // Anvil mines only on transactions, so a quiet chain would otherwise report itself
        // permanently degraded while the indexer is perfectly current. How old the data is
        // belongs in `meta.stale` on each response, not in the health of the service.
        (indexer.lagBlocks > 0 && input.now - indexer.updatedAt > input.staleAfterSeconds),
    );

  return degraded ? 'degraded' : 'healthy';
}

/** The registry's NAV validity window. Null rather than a guess if the read fails. */
async function readNavStaleAfter(
  client: ArcPublicClient,
  registry: string,
): Promise<number | null> {
  try {
    const value = await client.readContract({
      address: registry as `0x${string}`,
      abi: loadAbi('AssetRegistry'),
      functionName: 'navStaleAfter',
    });
    return Number(value);
  } catch {
    return null;
  }
}

/**
 * One line when a risk turns on, one when it clears. A WARN in a log someone is watching is a
 * real control; the alternative — a pager that does not exist — would imply coverage we do not
 * have, which is worse than saying nothing.
 */
function announce(
  logger: Logger | undefined,
  assetId: string,
  navStale: boolean,
  divergenceBps: number | null,
  navExpiresAt: number | null,
): void {
  if (logger === undefined) return;

  const diverged = divergenceBps !== null && Math.abs(divergenceBps) >= PRICE_DIVERGENCE_WARN_BPS;
  const previous = warned.get(assetId) ?? { stale: false, divergence: false };

  if (navStale !== previous.stale) {
    if (navStale) {
      logger.warn(
        { assetId, navExpiresAt },
        'NAV is stale: nothing on chain enforces this, and redemption still prices off it',
      );
    } else {
      logger.info({ assetId }, 'NAV republished, no longer stale');
    }
  }

  if (diverged !== previous.divergence) {
    if (diverged) {
      logger.warn(
        { assetId, divergenceBps, thresholdBps: PRICE_DIVERGENCE_WARN_BPS },
        'last traded price has diverged from NAV',
      );
    } else {
      logger.info({ assetId, divergenceBps }, 'traded price back within range of NAV');
    }
  }

  warned.set(assetId, { stale: navStale, divergence: diverged });
}

/** Tests need each case to start from no remembered state. */
export function resetRiskWarnings(): void {
  warned.clear();
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
