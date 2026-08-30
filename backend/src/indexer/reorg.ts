import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from '../chain/client.js';
import { ARC_EVENTS_WORKER } from './ingest.js';
import { rebuildProjections } from './rebuild.js';

/**
 * Reorg recovery.
 *
 * Every projection table cascades from `indexed_blocks (chain_id, number)`, so discarding an
 * orphaned range is one DELETE — the projections, their raw logs and the block rows go
 * together, in one transaction with the cursor rewind. There is no partial rollback state
 * for a crash to be caught in.
 *
 * What this file must never do is repair a divergence by overwriting. If our stored hash for
 * a block differs from the chain's, the blocks after the common ancestor are discarded and
 * re-indexed from the chain, because anything derived from an orphaned log is fiction.
 */

export interface ReorgResult {
  /** Highest block whose hash still matches the chain. */
  commonAncestor: bigint;
  /** How many blocks were discarded. Zero when the cursor was already canonical. */
  depth: number;
}

export interface RollbackCounts {
  blocks: number;
  logs: number;
}

/**
 * Walk back from `fromBlock` until a stored block hash matches the chain.
 *
 * Bounded by `maxDepth`: a divergence deeper than that is not a reorg any sane chain
 * produces, and continuing to walk would quietly rewrite the whole history. It is reported
 * as an error instead.
 */
export async function findCommonAncestor(
  db: Database,
  client: ArcPublicClient,
  chainId: number,
  fromBlock: bigint,
  maxDepth = 256,
): Promise<bigint | null> {
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const candidate = fromBlock - BigInt(depth);
    if (candidate < 0n) return null;

    const stored = await db.maybe<{ hash: string }>(
      'SELECT hash FROM indexed_blocks WHERE chain_id = $1 AND number = $2',
      [chainId, candidate.toString()],
    );

    // Nothing stored at this height: everything above is unknown to us, so this is as far
    // back as a rollback needs to reach.
    if (stored === null) return candidate;

    const onChain = await blockHash(client, candidate);
    if (onChain !== null && onChain === stored.hash) return candidate;
  }

  return null;
}

/**
 * Discard every block strictly above `ancestor` and rewind the cursor onto it.
 *
 * The DELETE cascades into `raw_logs` and every projection keyed by block, which is why the
 * projection tables were given that foreign key in the first place.
 */
export async function rollbackTo(
  db: Database,
  chainId: number,
  ancestor: bigint,
  logger?: Logger,
): Promise<RollbackCounts> {
  return db.withTransaction(async (tx) => {
    const { rows: logRows } = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM raw_logs
        WHERE chain_id = $1 AND block_number > $2`,
      [chainId, ancestor.toString()],
    );

    const { rowCount: blocks } = await tx.query(
      'DELETE FROM indexed_blocks WHERE chain_id = $1 AND number > $2',
      [chainId, ancestor.toString()],
    );

    const ancestorRow = await tx.query<{ hash: string; timestamp: bigint }>(
      'SELECT hash, timestamp FROM indexed_blocks WHERE chain_id = $1 AND number = $2',
      [chainId, ancestor.toString()],
    );
    const row = ancestorRow.rows[0];

    if (row === undefined) {
      // Rolled back past everything we hold: drop the cursor so the next run backfills from
      // START_BLOCK rather than resuming from a block that no longer exists.
      await tx.query('DELETE FROM indexer_cursors WHERE chain_id = $1 AND worker = $2', [
        chainId,
        ARC_EVENTS_WORKER,
      ]);
    } else {
      await tx.query(
        `UPDATE indexer_cursors
            SET block_number = $3, block_hash = $4, block_timestamp = $5,
                reorg_depth = reorg_depth + $6, updated_at = now()
          WHERE chain_id = $1 AND worker = $2`,
        [
          chainId,
          ARC_EVENTS_WORKER,
          ancestor.toString(),
          row.hash,
          row.timestamp.toString(),
          blocks,
        ],
      );
    }

    const counts = { blocks, logs: Number(logRows[0]?.count ?? '0') };
    if (counts.blocks > 0) {
      logger?.warn({ ancestor: ancestor.toString(), ...counts }, 'rolled back reorged blocks');
    }
    return counts;
  });
}

/**
 * Verify the cursor still sits on the canonical chain, rolling back if it does not.
 * Called before every ingestion pass, so a reorg is handled at the point of discovery.
 */
export async function reconcileCursor(
  db: Database,
  client: ArcPublicClient,
  config: Config,
  logger?: Logger,
): Promise<ReorgResult | null> {
  const chainId = config.CHAIN_ID;
  const cursor = await db.maybe<{ block_number: bigint; block_hash: string }>(
    'SELECT block_number, block_hash FROM indexer_cursors WHERE chain_id = $1 AND worker = $2',
    [chainId, ARC_EVENTS_WORKER],
  );
  if (cursor === null) return null;

  const onChain = await blockHash(client, cursor.block_number);
  if (onChain !== null && onChain === cursor.block_hash) return null;

  const ancestor = await findCommonAncestor(db, client, chainId, cursor.block_number);
  if (ancestor === null) {
    throw new Error(
      `reorg deeper than the search window at block ${cursor.block_number}: refusing to rewrite history`,
    );
  }

  const { blocks } = await rollbackTo(db, chainId, ancestor, logger);

  // Deleting the orphaned blocks removes their logs and every block-keyed history row, but
  // the current-state aggregates (supply, balances, vault categories, positions, identities)
  // are incremental and carry no block key. They are re-derived from the logs that survived.
  if (blocks > 0) {
    await rebuildProjections(db, config, logger);
  }

  return { commonAncestor: ancestor, depth: blocks };
}

async function blockHash(client: ArcPublicClient, blockNumber: bigint): Promise<string | null> {
  try {
    const block = await client.getBlock({ blockNumber, includeTransactions: false });
    return block.hash.toLowerCase();
  } catch {
    // Past the head after a restart, or pruned.
    return null;
  }
}
