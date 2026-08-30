import type { Logger } from 'pino';
import type { Database, Queryable } from '../db/client.js';
import { decodeLog, serialiseArgs, type AddressKind } from './decode.js';
import type { WatchedSet } from './watched.js';
import type { LogContext, ProjectionDeps, Projector } from './projections/types.js';
import { factoryProjectors, registryProjectors } from './projections/registry.js';
import { tokenProjectors } from './projections/token.js';
import { vaultProjectors } from './projections/vault.js';
import {
  offeringProjectors,
  redemptionProjectors,
  revenueProjectors,
} from './projections/lifecycle.js';
import { marketProjectors } from './projections/market.js';
import {
  complianceModuleProjectors,
  complianceProjectors,
  identityProjectors,
} from './projections/compliance.js';

/**
 * Ingestion.
 *
 * One database transaction per block: raw logs, projections, the block row and the cursor
 * all commit together, so the cursor can never claim a block whose effects were not written.
 *
 * Idempotency is structural. A log is inserted into `raw_logs` with
 * `ON CONFLICT DO NOTHING` on `(chain_id, transaction_hash, log_index)` and projected **only
 * when that insert created a row**. That is what makes the incremental arithmetic in the
 * projectors — balances, supply, category balances — safe to replay.
 */

const PROJECTORS: Partial<Record<AddressKind, Record<string, Projector>>> = {
  registry: registryProjectors,
  factory: factoryProjectors,
  token: tokenProjectors,
  vault: vaultProjectors,
  offering: offeringProjectors,
  revenueDistributor: revenueProjectors,
  redemptionController: redemptionProjectors,
  marketManager: marketProjectors,
  identityRegistry: identityProjectors,
  compliance: complianceProjectors,
  complianceModule: complianceModuleProjectors,
};

export interface ChainLog {
  address: string;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
}

export interface ChainBlock {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
}

export interface IngestResult {
  blocksIngested: number;
  logsStored: number;
  logsProjected: number;
  logsUnknown: number;
}

export const ARC_EVENTS_WORKER = 'arc-events';

/**
 * Ingest a contiguous, already-ordered batch of blocks and their logs. Each block commits
 * separately: a failure part-way through leaves the cursor at the last fully-written block
 * rather than losing the whole range.
 */
export async function ingestBlocks(
  db: Database,
  chainId: number,
  watched: WatchedSet,
  blocks: ChainBlock[],
  logsByBlock: Map<string, ChainLog[]>,
  logger?: Logger,
): Promise<IngestResult> {
  const result: IngestResult = {
    blocksIngested: 0,
    logsStored: 0,
    logsProjected: 0,
    logsUnknown: 0,
  };

  for (const block of blocks) {
    const logs = logsByBlock.get(block.number.toString()) ?? [];
    // Strict chain order: block, then transaction index, then log index.
    logs.sort((a, b) =>
      a.transactionIndex === b.transactionIndex
        ? a.logIndex - b.logIndex
        : a.transactionIndex - b.transactionIndex,
    );

    await db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (chain_id, number) DO NOTHING`,
        [
          chainId,
          block.number.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase(),
          block.timestamp.toString(),
        ],
      );

      for (const log of logs) {
        const stored = await ingestLog(tx, chainId, watched, block, log, result, logger);
        if (stored) result.logsStored += 1;
      }

      await tx.query(
        `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (chain_id, worker)
         DO UPDATE SET block_number = EXCLUDED.block_number,
                       block_hash = EXCLUDED.block_hash,
                       block_timestamp = EXCLUDED.block_timestamp,
                       reorg_depth = 0,
                       last_error = NULL,
                       updated_at = now()`,
        [
          chainId,
          ARC_EVENTS_WORKER,
          block.number.toString(),
          block.hash.toLowerCase(),
          block.timestamp.toString(),
        ],
      );
    });

    result.blocksIngested += 1;
  }

  return result;
}

async function ingestLog(
  tx: Queryable,
  chainId: number,
  watched: WatchedSet,
  block: ChainBlock,
  log: ChainLog,
  result: IngestResult,
  logger?: Logger,
): Promise<boolean> {
  const address = log.address.toLowerCase() as `0x${string}`;
  const entry = watched.get(address);
  // A log from an address we do not watch is not ours to interpret.
  if (entry === undefined) return false;

  const decoded = decodeLog(entry.kind, { topics: log.topics, data: log.data });

  const { rowCount } = await tx.query(
    `INSERT INTO raw_logs (chain_id, transaction_hash, log_index, block_number, block_hash,
                           transaction_index, address, topic0, topic1, topic2, topic3, data,
                           event_name, contract_name, decoded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [
      chainId,
      log.transactionHash.toLowerCase(),
      log.logIndex,
      block.number.toString(),
      block.hash.toLowerCase(),
      log.transactionIndex,
      address,
      topicAt(log, 0),
      topicAt(log, 1),
      topicAt(log, 2),
      topicAt(log, 3),
      log.data.toLowerCase(),
      decoded.eventName,
      decoded.contractName,
      serialiseArgs(decoded.args),
    ],
  );

  // Already ingested. Re-projecting would double-count every incremental balance.
  if (rowCount === 0) return false;

  if (decoded.eventName === null || decoded.args === null) {
    // Retained for diagnosis, never projected as trusted state.
    result.logsUnknown += 1;
    return true;
  }

  const projected = await projectDecodedLog(
    tx,
    chainId,
    watched,
    entry,
    {
      transaction_hash: log.transactionHash.toLowerCase(),
      log_index: log.logIndex,
      block_number: block.number,
      transaction_index: log.transactionIndex,
      address,
      topic0: topicAt(log, 0),
      topic1: topicAt(log, 1),
      topic2: topicAt(log, 2),
      topic3: topicAt(log, 3),
      data: log.data.toLowerCase(),
      block_timestamp: block.timestamp,
    },
    decoded,
    logger,
  );

  if (projected) result.logsProjected += 1;
  return true;
}

/** A `raw_logs` row joined to its block timestamp, as the rebuild path reads it. */
export interface StoredLogRow {
  transaction_hash: string;
  log_index: number;
  block_number: bigint;
  transaction_index: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
  block_timestamp: bigint;
}

/**
 * Apply one decoded log to the read model.
 *
 * Shared by live ingestion and the post-rollback rebuild, so a projection can never behave
 * differently depending on which path reached it. Returns false when no projector claims the
 * event — the log is still archived, it simply has no aggregate to update.
 */
export async function projectDecodedLog(
  tx: Queryable,
  chainId: number,
  watched: WatchedSet,
  entry: { kind: AddressKind; assetId: string | null },
  row: StoredLogRow,
  decoded: { eventName: string | null; args: Record<string, unknown> | null },
  logger?: Logger,
): Promise<boolean> {
  if (decoded.eventName === null || decoded.args === null) return false;

  const projector = PROJECTORS[entry.kind]?.[decoded.eventName];
  if (projector === undefined) return false;

  const ctx: LogContext = {
    chainId,
    blockNumber: row.block_number,
    blockTimestamp: row.block_timestamp,
    transactionHash: row.transaction_hash,
    transactionIndex: row.transaction_index,
    logIndex: row.log_index,
    address: row.address as `0x${string}`,
    kind: entry.kind,
    assetId: entry.assetId,
  };

  const deps: ProjectionDeps = {
    tx,
    watched,
    flagAnomaly: (anomalyCtx, kind, detail) => recordAnomaly(tx, anomalyCtx, kind, detail, logger),
  };

  await projector(ctx, decoded.args, deps);
  return true;
}

async function recordAnomaly(
  tx: Queryable,
  ctx: LogContext,
  kind: string,
  detail: Record<string, unknown>,
  logger?: Logger,
): Promise<void> {
  logger?.warn({ kind, ...detail, txHash: ctx.transactionHash }, 'projection anomaly');
  await tx.query(
    `INSERT INTO projection_anomalies (chain_id, block_number, transaction_hash, log_index,
                                       worker, kind, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ctx.chainId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      ARC_EVENTS_WORKER,
      kind,
      JSON.stringify(detail),
    ],
  );
}

function topicAt(log: ChainLog, index: number): string | null {
  const topic = log.topics[index];
  return topic === undefined ? null : topic.toLowerCase();
}
