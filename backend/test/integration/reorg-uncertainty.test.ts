import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig } from '../helpers/chain.js';
import { registerChain } from '../../src/chain/identity.js';
import { reconcileCursor } from '../../src/indexer/reorg.js';
import type { Database } from '../../src/db/client.js';

/**
 * A block hash we could not READ is not a block hash that DIFFERS.
 *
 * On 2026-09-12 the indexer twice "rolled back a reorg" on Hedera, which has no reorgs: a
 * transient getBlock failure on the rate-limited relay came back as null, null was read as a
 * mismatch, and each false rollback rebuilt every projection — which in turn dropped three
 * discovered addresses. These cases pin the three shapes apart, with no chain involved.
 */

const config = testConfig();
let db: Database;

const hash = (byte: string): string => `0x${byte.repeat(32)}`;

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
  await registerChain(db, config);

  // Blocks 88-90 indexed, cursor at 90. Block 87 was never stored, so it is the floor of any
  // rollback: everything above it is ours to discard if the chain really diverged.
  for (const [number, byte] of [
    [88, 'a8'],
    [89, 'a9'],
    [90, 'aa'],
  ] as const) {
    await db.query(
      `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [config.CHAIN_ID, number, hash(byte), hash('00'), 1_786_932_000 + number],
    );
  }
  await db.query(
    `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
     VALUES ($1, 'arc-events', 90, $2, $3)`,
    [config.CHAIN_ID, hash('aa'), 1_786_932_090],
  );
});

afterAll(async () => {
  await closeTestDatabase();
});

async function storedBlocks(): Promise<number[]> {
  const { rows } = await db.query<{ number: string }>(
    'SELECT number::text FROM indexed_blocks WHERE chain_id = $1 ORDER BY number',
    [config.CHAIN_ID],
  );
  return rows.map((row) => Number(row.number));
}

async function cursorBlock(): Promise<number> {
  const row = await db.one<{ block_number: string }>(
    "SELECT block_number::text FROM indexer_cursors WHERE worker = 'arc-events'",
  );
  return Number(row.block_number);
}

describe('reconcileCursor under uncertainty', () => {
  it('does not roll back when the cursor block exists but its hash cannot be read', async () => {
    // Head 100 is well past the cursor, so block 90 exists — the relay just failed to return
    // it. That is the Hedera case exactly, and it is evidence of nothing.
    const client = stubClient({ latestBlock: 100n, blocks: {} });

    const result = await reconcileCursor(db, client, config);

    expect(result).toBeNull();
    expect(await storedBlocks()).toEqual([88, 89, 90]);
    expect(await cursorBlock()).toBe(90);
  });

  it('does not deepen a rollback when a hash read fails partway down the walk', async () => {
    // A definite mismatch at the cursor starts a walk; the next block down is unreadable.
    // Stepping past it would discard blocks that may be perfectly canonical, and enough failures
    // in a row would exhaust the search window and halt the indexer on relay jitter alone.
    const client = stubClient({ latestBlock: 100n, blocks: { '90': hash('ff') } });

    const result = await reconcileCursor(db, client, config);

    expect(result).toBeNull();
    expect(await storedBlocks()).toEqual([88, 89, 90]);
    expect(await cursorBlock()).toBe(90);
  });

  it('does not roll back when one lagging relay node reports a head below the tip', async () => {
    // The first head read comes from a backend 20 blocks behind, the second from an up-to-date
    // peer. Taken alone, the first read says block 90 is beyond the head — a shorter chain.
    // It is not: the chain is fine and one node is slow, which is routine behind a load
    // balancer. The cursor sits at the tip, exactly where this happens.
    const client = stubClient({ latestBlocks: [70n, 100n], blocks: {} });

    const result = await reconcileCursor(db, client, config);

    expect(result).toBeNull();
    expect(await storedBlocks()).toEqual([88, 89, 90]);
    expect(await cursorBlock()).toBe(90);
  });

  it('still rolls back when the chain really is shorter than the cursor', async () => {
    // Head 50 is below every stored block: the chain was rewound (an evm_revert, a replaced
    // Anvil). A missing block there IS divergence, and the fix must not turn it into "unknown".
    const client = stubClient({ latestBlock: 50n, blocks: {} });

    const result = await reconcileCursor(db, client, config);

    expect(result).not.toBeNull();
    expect(result!.depth).toBe(3);
    expect(await storedBlocks()).toEqual([]);
    // Rolled back past everything held, so rollbackTo drops the cursor on purpose: the next pass
    // backfills from START_BLOCK rather than resuming from a block that no longer exists.
    const cursors = await db.query("SELECT 1 FROM indexer_cursors WHERE worker = 'arc-events'");
    expect(cursors.rows).toHaveLength(0);
  });

  it('still rolls back on a definite hash mismatch with readable history below it', async () => {
    // Block 90 differs, 89 matches: an ordinary one-block reorg, resolved to its true ancestor.
    const client = stubClient({
      latestBlock: 100n,
      blocks: { '90': hash('ff'), '89': hash('a9') },
    });

    const result = await reconcileCursor(db, client, config);

    expect(result).toEqual({ commonAncestor: 89n, depth: 1 });
    expect(await storedBlocks()).toEqual([88, 89]);
    expect(await cursorBlock()).toBe(89);
  });
});
