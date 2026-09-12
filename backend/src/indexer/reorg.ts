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

/**
 * What reading a block's hash actually told us. The distinction is the whole fix: before it,
 * all three failure shapes collapsed into `null`, and `null` was read as "the hash differs".
 *
 * - `found`: the chain answered; compare it.
 * - `beyond-head`: the chain is shorter than this height — genuine divergence evidence, as
 *   after an Anvil `evm_revert`.
 * - `unavailable`: the block should exist and the read failed. A rate-limited relay does this
 *   routinely, and on Hedera — which has no reorgs at all — it produced two "rollbacks" that
 *   each rebuilt every projection. It is evidence of nothing, so it must never cause a rollback.
 */
type HashRead =
  | { kind: 'found'; hash: string }
  | { kind: 'beyond-head' }
  | { kind: 'unavailable' };

/** Raised when a hash read fails mid-walk: the walk stops rather than guessing further back. */
export class BlockHashUnavailableError extends Error {
  constructor(readonly blockNumber: bigint) {
    super(`could not read the hash of block ${blockNumber}; not treating an unreadable block as a reorg`);
    this.name = 'BlockHashUnavailableError';
  }
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
  const head = await chainHead(client);

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

    const read = await readHash(client, candidate, head);
    if (read.kind === 'found' && read.hash === stored.hash) return candidate;
    // A failed read is not a mismatch. Stepping back past it would deepen the rollback beyond
    // the real divergence, and enough consecutive failures would exhaust the window and halt
    // the indexer on nothing but relay jitter. Stop, and let the next pass try again.
    if (read.kind === 'unavailable') throw new BlockHashUnavailableError(candidate);
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
    // Read before anything moves: the cursor may be deleted below, and with it the only place
    // that knew which block failed its check.
    const cursorBefore = await tx.query<{ block_number: string }>(
      'SELECT block_number::text FROM indexer_cursors WHERE chain_id = $1 AND worker = $2',
      [chainId, ARC_EVENTS_WORKER],
    );

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
      // Durable, and outside everything that erases history: no cascade from indexed_blocks, not
      // cleared by a rebuild. The cursor's own reorg_depth cannot do this job, because the cursor
      // is exactly what a deep rollback deletes.
      await tx.query(
        `INSERT INTO indexer_rollbacks (chain_id, worker, from_block, ancestor_block,
                                        blocks_discarded, logs_discarded, cursor_deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          chainId,
          ARC_EVENTS_WORKER,
          cursorBefore.rows[0]?.block_number ?? ancestor.toString(),
          ancestor.toString(),
          counts.blocks,
          counts.logs,
          row === undefined,
        ],
      );
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

  const read = await readHash(client, cursor.block_number, await chainHead(client));
  if (read.kind === 'found' && read.hash === cursor.block_hash) return null;
  if (read.kind === 'unavailable') {
    // Said out loud: this used to fall through into a rollback and a full rebuild, silently.
    logger?.warn(
      { blockNumber: cursor.block_number.toString() },
      'could not read the cursor block hash; skipping the reorg check this pass rather than guessing',
    );
    return null;
  }

  let ancestor: bigint | null;
  try {
    ancestor = await findCommonAncestor(db, client, chainId, cursor.block_number);
  } catch (error) {
    if (!(error instanceof BlockHashUnavailableError)) throw error;
    logger?.warn(
      { blockNumber: error.blockNumber.toString() },
      'a block hash became unreadable while locating the common ancestor; retrying next pass',
    );
    return null;
  }
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

async function readHash(
  client: ArcPublicClient,
  blockNumber: bigint,
  head: bigint | null,
): Promise<HashRead> {
  try {
    const block = await client.getBlock({ blockNumber, includeTransactions: false });
    return { kind: 'found', hash: block.hash.toLowerCase() };
  } catch {
    // Only a head we actually read can say the block is gone. With no head, or a head at or
    // above this height, the block should exist and we simply failed to read it.
    if (head === null || blockNumber <= head) return { kind: 'unavailable' };

    // A load-balanced relay (Hashio, dRPC) can route this read to a backend a few blocks
    // behind its peers: that node fails the tip block and reports a head below it, which
    // reads exactly like a shorter chain — and the cursor lives at the tip, which is precisely
    // the window where it happens. Ask again. A chain that really got shorter still says so;
    // a lagging node usually does not, and one disagreement is enough to call it unknown.
    const second = await chainHead(client);
    return second !== null && blockNumber > second ? { kind: 'beyond-head' } : { kind: 'unavailable' };
  }
}

async function chainHead(client: ArcPublicClient): Promise<bigint | null> {
  try {
    return await client.getBlockNumber();
  } catch {
    return null;
  }
}
