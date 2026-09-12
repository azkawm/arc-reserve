import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import type { CursorPosition } from '../api/envelope.js';
import type { Logger } from 'pino';
import { loadAbi } from '../chain/abis.js';
import { ApiError } from '../lib/errors.js';
import type { ChainRegistry } from '../api/chain-context.js';
import type { HealthPayload, HealthStatus } from '../api/schemas/health.js';

export interface HealthDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  startedAt: number;
  version: string;
  logger?: Logger;
  /** Resolves any chain in the database to its own client and registry. Absent: own chain only. */
  chains?: ChainRegistry;
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
  chain_id: string;
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

  // Per-asset NAV exposure for EVERY chain in the database this process can read — not only the
  // one it indexes. One API URL serves every chain, and this block is the only control between a
  // stale NAV and mispriced redemptions; scoped to the indexed chain, another chain's risk would
  // be absent from the documented URL, and absent reads exactly like all-clear.
  //
  // Each chain is resolved the way the asset routes resolve it: its own registry from its chains
  // row, read through its own RPC. Never the configured registry — the same deployer at the same
  // nonce put different contracts at one address on two chains. A chain that cannot be read here
  // is NAMED in riskCoverage.notComputed, so omission can never pass for safety.
  let risks: HealthPayload['risks'] = [];
  const riskCoverage: HealthPayload['riskCoverage'] = { computed: [], notComputed: [] };
  if (database.ok) {
    const { rows } = await db.query<RiskRow>(
      `SELECT a.chain_id::text, a.asset_id, a.current_nav::text, a.nav_updated_at,
              (SELECT c.close_raw::text
                 FROM candles c
                WHERE c.chain_id = a.chain_id AND c.pool = d.pool AND c.interval_seconds = 3600
                ORDER BY c.bucket_start DESC LIMIT 1) AS last_price
         FROM assets a
         LEFT JOIN asset_deployments d ON d.chain_id = a.chain_id AND d.asset_id = a.asset_id
        ORDER BY a.chain_id, a.asset_id`,
    );

    const staleAfterByChain = new Map<number, number>();
    for (const chainId of [...new Set(rows.map((row) => Number(row.chain_id)))]) {
      const reader = await riskReaderFor(deps, chainId);
      if (reader.kind === 'unreadable') {
        riskCoverage.notComputed.push({ chainId, reason: reader.reason });
        continue;
      }
      const navStaleAfter = await navPolicyFor(chainId, reader.client, reader.registry, now);
      if (navStaleAfter === null) {
        // Never read successfully: how long a NAV stays valid on this chain is unknown, so no
        // deadline exists to report. Said as such, rather than a null deadline — which would read
        // exactly like an asset that simply has no NAV.
        riskCoverage.notComputed.push({
          chainId,
          reason: `could not read navStaleAfter from the registry on chain ${chainId}`,
        });
        continue;
      }
      riskCoverage.computed.push(chainId);
      staleAfterByChain.set(chainId, navStaleAfter);
    }

    risks = rows
      .filter((row) => staleAfterByChain.has(Number(row.chain_id)))
      .map((row) => {
        const chainId = Number(row.chain_id);
        const navStaleAfter = staleAfterByChain.get(chainId) ?? null;
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

        announce(deps.logger, chainId, row.asset_id, navStale, lastPriceVsNavBps, expiresAt);
        return {
          chainId,
          assetId: row.asset_id,
          navExpiresAt: expiresAt,
          navStale,
          lastPriceVsNavBps,
        };
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
    riskCoverage,
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

type RiskReader =
  | { kind: 'readable'; client: ArcPublicClient; registry: `0x${string}` }
  | { kind: 'unreadable'; reason: string };

/** How this process reads a chain for risk: its own chain directly, any other through the registry. */
async function riskReaderFor(deps: HealthDeps, chainId: number): Promise<RiskReader> {
  if (deps.chains === undefined) {
    return chainId === deps.config.CHAIN_ID
      ? { kind: 'readable', client: deps.client, registry: deps.config.addresses.registry }
      : { kind: 'unreadable', reason: 'this process has no way to read that chain' };
  }
  try {
    const context = await deps.chains.resolve(chainId);
    return { kind: 'readable', client: context.client, registry: context.registry };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // The registry already says WHY — no RPC, an endpoint that would not verify, or one answering
    // as a different chain. Replacing that with one fixed string would tell an operator whose URL
    // is set, but wrong, to go and set it.
    return { kind: 'unreadable', reason: error.message };
  }
}

/**
 * `navStaleAfter` is registry POLICY — set at deploy, changed only by an admin — so it is cached per
 * (chain, registry) rather than read on every poll. Health is polled after every confirmed
 * transaction, and on a free relay a read per chain per poll is how the reads that matter start
 * getting refused. Keyed by registry as well as chain: the same address holds different contracts
 * on different chains. A failed refresh keeps the value last actually read instead of blanking every
 * deadline on each poll; a chain never read successfully returns null, and is reported as unknown.
 */
const NAV_POLICY_TTL_SECONDS = 600;
const navPolicy = new Map<string, { value: number; readAt: number }>();

async function navPolicyFor(
  chainId: number,
  client: ArcPublicClient,
  registry: string,
  now: number,
): Promise<number | null> {
  const key = `${chainId}:${registry.toLowerCase()}`;
  const cached = navPolicy.get(key);
  if (cached !== undefined && now - cached.readAt < NAV_POLICY_TTL_SECONDS) return cached.value;

  const fresh = await readNavStaleAfter(client, registry);
  if (fresh !== null) {
    navPolicy.set(key, { value: fresh, readAt: now });
    return fresh;
  }
  return cached?.value ?? null;
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
  chainId: number,
  assetId: string,
  navStale: boolean,
  divergenceBps: number | null,
  navExpiresAt: number | null,
): void {
  if (logger === undefined) return;

  // Keyed by chain AND asset: nothing guarantees an assetId is unique across chains, and a shared
  // key would let one chain's transition silence the other's.
  const key = `${chainId}:${assetId}`;
  const diverged = divergenceBps !== null && Math.abs(divergenceBps) >= PRICE_DIVERGENCE_WARN_BPS;
  const previous = warned.get(key) ?? { stale: false, divergence: false };

  if (navStale !== previous.stale) {
    if (navStale) {
      logger.warn(
        { chainId, assetId, navExpiresAt },
        'NAV is stale: nothing on chain enforces this, and redemption still prices off it',
      );
    } else {
      logger.info({ chainId, assetId }, 'NAV republished, no longer stale');
    }
  }

  if (diverged !== previous.divergence) {
    if (diverged) {
      logger.warn(
        { chainId, assetId, divergenceBps, thresholdBps: PRICE_DIVERGENCE_WARN_BPS },
        'last traded price has diverged from NAV',
      );
    } else {
      logger.info({ chainId, assetId, divergenceBps }, 'traded price back within range of NAV');
    }
  }

  warned.set(key, { stale: navStale, divergence: diverged });
}

/** Tests need each case to start from no remembered state: no warnings, no cached policy. */
export function resetRiskWarnings(): void {
  warned.clear();
  navPolicy.clear();
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
