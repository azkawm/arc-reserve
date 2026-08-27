import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import type { Database } from '../../src/db/client.js';

/**
 * The chain-integrity schema is the foundation every later projection sits on, so its
 * guarantees are tested against a real PostgreSQL rather than asserted in prose:
 * idempotent ingestion, atomic cursor advancement, cascade rollback, and multi-chain
 * isolation in one database.
 */

const CHAIN = {
  anvil: 31337,
  baseSepolia: 84532,
};

const ADDRESS = {
  registry: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  factory: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
  musd: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
};

const hash = (seed: string): string => `0x${seed.repeat(64).slice(0, 64)}`;

/**
 * Probe a domain by casting to it. Casting enforces the domain CHECK the same way a column
 * write does, and unlike a temp table it does not depend on which pooled connection runs.
 */
async function cast(value: string, domain: 'uint256' | 'int256'): Promise<string> {
  const row = await db.one<{ value: string }>(
    `SELECT ($1::numeric)::${domain}::text AS value`,
    [value],
  );
  return row.value;
}

let db: Database;

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
});

afterAll(async () => {
  await closeTestDatabase();
});

async function seedChain(chainId: number): Promise<void> {
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, $2, 0, $3, $4, $5, 0)`,
    [chainId, `chain-${chainId}`, ADDRESS.registry, ADDRESS.factory, ADDRESS.musd],
  );
}

async function seedBlock(chainId: number, number: number, seed = 'a'): Promise<void> {
  await db.query(
    `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
     VALUES ($1, $2, $3, $4, $5)`,
    [chainId, number, hash(seed), hash(seed === 'a' ? 'b' : 'c'), 1_786_932_000 + number],
  );
}

describe('domains', () => {
  beforeEach(() => seedChain(CHAIN.anvil));

  it('rejects a mixed-case address, so a checksummed value can never become a second key', async () => {
    await expect(
      db.query(
        `INSERT INTO chains (chain_id, name, registry_address, factory_address, stablecoin_address)
         VALUES ($1, 'x', $2, $3, $4)`,
        [CHAIN.baseSepolia, '0xE7f1725E7734CE288F8367e1Bb143E90bb3F0512', ADDRESS.factory, ADDRESS.musd],
      ),
    ).rejects.toThrow(/eth_address/);
  });

  it('rejects a hash of the wrong length', async () => {
    await expect(
      db.query(
        `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
         VALUES ($1, 1, '0xdeadbeef', $2, 1)`,
        [CHAIN.anvil, hash('b')],
      ),
    ).rejects.toThrow(/eth_hash/);
  });

  it('rejects a fractional uint256, which is how a float would enter the ledger', async () => {
    // Must reject, not round. A NUMERIC(78,0) domain accepts '1.5' and stores 2, because the
    // typmod is applied before the domain CHECK.
    for (const bad of ['1.5', '0.000001', '-1', (2n ** 256n).toString()]) {
      await expect(cast(bad, 'uint256')).rejects.toThrow(/uint256/);
    }

    // 2^256 - 1 must survive exactly.
    const max = (2n ** 256n - 1n).toString();
    await expect(cast(max, 'uint256')).resolves.toBe(max);
    await expect(cast('0', 'uint256')).resolves.toBe('0');
  });

  it('keeps a signed allocation delta exact in both directions', async () => {
    // AllocationChanged carries a signed delta; a redemption debit must stay exact.
    await expect(cast('-20000000000', 'int256')).resolves.toBe('-20000000000');
    await expect(cast('20000000000', 'int256')).resolves.toBe('20000000000');
    await expect(cast('-1.5', 'int256')).rejects.toThrow(/int256/);
    await expect(cast((2n ** 255n).toString(), 'int256')).rejects.toThrow(/int256/);
  });

  it('refuses a mainnet chain id at the storage layer (D-027)', async () => {
    await expect(
      db.query(
        `INSERT INTO chains (chain_id, name, registry_address, factory_address, stablecoin_address)
         VALUES (1, 'Ethereum', $1, $2, $3)`,
        [ADDRESS.registry, ADDRESS.factory, ADDRESS.musd],
      ),
    ).rejects.toThrow(/chains_testnet_only/);
  });
});

describe('idempotent ingestion', () => {
  beforeEach(async () => {
    await seedChain(CHAIN.anvil);
    await seedBlock(CHAIN.anvil, 10);
  });

  it('accepts the same log twice and stores it once', async () => {
    const insert = () =>
      db.query(
        `INSERT INTO raw_logs (chain_id, transaction_hash, log_index, block_number, block_hash,
                               transaction_index, address, topic0, data, event_name)
         VALUES ($1, $2, 0, 10, $3, 0, $4, $5, '0x', 'NAVUpdated')
         ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
        [CHAIN.anvil, hash('d'), hash('a'), ADDRESS.registry, hash('e')],
      );

    await insert();
    await insert();

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM raw_logs',
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('rejects a second block hash at the same height instead of overwriting it', async () => {
    await expect(seedBlock(CHAIN.anvil, 10, 'f')).rejects.toThrow(/indexed_blocks_pkey/);
  });

  it('rejects the same hash appearing at two heights on one chain', async () => {
    await expect(seedBlock(CHAIN.anvil, 11, 'a')).rejects.toThrow(
      /indexed_blocks_chain_hash_key/,
    );
  });
});

describe('reorg rollback primitive', () => {
  it('deletes the logs of an orphaned block with the block itself', async () => {
    await seedChain(CHAIN.anvil);
    await seedBlock(CHAIN.anvil, 10);
    await db.query(
      `INSERT INTO raw_logs (chain_id, transaction_hash, log_index, block_number, block_hash,
                             transaction_index, address, data)
       VALUES ($1, $2, 0, 10, $3, 0, $4, '0x')`,
      [CHAIN.anvil, hash('d'), hash('a'), ADDRESS.registry],
    );

    await db.query('DELETE FROM indexed_blocks WHERE chain_id = $1 AND number >= 10', [CHAIN.anvil]);

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM raw_logs',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('cannot record a log for a block it has not indexed', async () => {
    await seedChain(CHAIN.anvil);
    await expect(
      db.query(
        `INSERT INTO raw_logs (chain_id, transaction_hash, log_index, block_number, block_hash,
                               transaction_index, address, data)
         VALUES ($1, $2, 0, 999, $3, 0, $4, '0x')`,
        [CHAIN.anvil, hash('d'), hash('a'), ADDRESS.registry],
      ),
    ).rejects.toThrow(/raw_logs_chain_id_block_number_fkey/);
  });
});

describe('atomic cursor advancement', () => {
  it('commits logs and the cursor together', async () => {
    await seedChain(CHAIN.anvil);

    await db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
         VALUES ($1, 10, $2, $3, 1)`,
        [CHAIN.anvil, hash('a'), hash('b')],
      );
      await tx.query(
        `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
         VALUES ($1, 'arc-events', 10, $2, 1)`,
        [CHAIN.anvil, hash('a')],
      );
    });

    const cursor = await db.one<{ block_number: bigint }>(
      'SELECT block_number FROM indexer_cursors WHERE chain_id = $1',
      [CHAIN.anvil],
    );
    expect(cursor.block_number).toBe(10n);
  });

  it('leaves no block behind when the cursor write fails', async () => {
    // The failure that matters: a cursor claiming a block whose logs were never written, or
    // a block written without the cursor that proves it was processed.
    await seedChain(CHAIN.anvil);

    await expect(
      db.withTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO indexed_blocks (chain_id, number, hash, parent_hash, timestamp)
           VALUES ($1, 11, $2, $3, 1)`,
          [CHAIN.anvil, hash('a'), hash('b')],
        );
        await tx.query(
          `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
           VALUES ($1, 'arc-events', 11, 'not-a-hash', 1)`,
          [CHAIN.anvil],
        );
      }),
    ).rejects.toThrow(/eth_hash/);

    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM indexed_blocks',
    );
    expect(rows[0]?.count).toBe('0');
  });
});

describe('multi-chain isolation', () => {
  it('keeps two chains at the same block height apart', async () => {
    await seedChain(CHAIN.anvil);
    await seedChain(CHAIN.baseSepolia);
    await seedBlock(CHAIN.anvil, 10, 'a');
    await seedBlock(CHAIN.baseSepolia, 10, 'b');

    const anvil = await db.one<{ hash: string }>(
      'SELECT hash FROM indexed_blocks WHERE chain_id = $1 AND number = 10',
      [CHAIN.anvil],
    );
    const base = await db.one<{ hash: string }>(
      'SELECT hash FROM indexed_blocks WHERE chain_id = $1 AND number = 10',
      [CHAIN.baseSepolia],
    );
    expect(anvil.hash).not.toBe(base.hash);
  });

  it('rolls back one chain without touching the other', async () => {
    await seedChain(CHAIN.anvil);
    await seedChain(CHAIN.baseSepolia);
    await seedBlock(CHAIN.anvil, 10, 'a');
    await seedBlock(CHAIN.baseSepolia, 10, 'b');

    await db.query('DELETE FROM indexed_blocks WHERE chain_id = $1', [CHAIN.anvil]);

    const { rows } = await db.query<{ chain_id: bigint }>('SELECT chain_id FROM indexed_blocks');
    expect(rows.map((row) => Number(row.chain_id))).toEqual([CHAIN.baseSepolia]);
  });
});

describe('projection anomalies', () => {
  it('records a flagged row rather than losing the discrepancy', async () => {
    await seedChain(CHAIN.anvil);
    await db.query(
      `INSERT INTO projection_anomalies (chain_id, block_number, transaction_hash, log_index,
                                         worker, kind, detail)
       VALUES ($1, 10, $2, 0, 'arc-events', 'allocation_balance_mismatch', $3)`,
      [
        CHAIN.anvil,
        hash('d'),
        JSON.stringify({ category: 'REDEMPTION_RESERVE', emitted: '20000000000', applied: '19999999999' }),
      ],
    );

    const row = await db.one<{ kind: string; detail: { category: string }; resolved: boolean }>(
      'SELECT kind, detail, resolved FROM projection_anomalies',
    );
    expect(row.kind).toBe('allocation_balance_mismatch');
    expect(row.detail.category).toBe('REDEMPTION_RESERVE');
    expect(row.resolved).toBe(false);
  });
});
