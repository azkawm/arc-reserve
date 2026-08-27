import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig, TEST_ADDRESSES } from '../helpers/chain.js';
import {
  assertChainReady,
  inspectCursor,
  registerChain,
  verifyChainIdentity,
  verifyDeploymentPresent,
} from '../../src/chain/identity.js';
import { StartupError } from '../../src/lib/errors.js';
import type { Database } from '../../src/db/client.js';

/**
 * These are the guards that stand between "the chain I was configured for" and "some chain".
 * Each test is a way the demo actually breaks: Anvil restarted, the wrong RPC in .env, a
 * database left over from yesterday's deployment.
 */

const config = testConfig();
let db: Database;

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
});

afterAll(async () => {
  await closeTestDatabase();
});

const hash = (seed: string): string => `0x${seed.repeat(64).slice(0, 64)}`;

describe('verifyChainIdentity', () => {
  it('accepts an RPC that reports the configured chain', async () => {
    await expect(verifyChainIdentity(stubClient({ chainId: 31337 }), config)).resolves.toBe(31337);
  });

  it('refuses an RPC pointed at a different chain', async () => {
    await expect(verifyChainIdentity(stubClient({ chainId: 84532 }), config)).rejects.toThrow(
      /chain mismatch: CHAIN_ID=31337 but .* reports 84532/,
    );
  });

  it('explains an unreachable RPC instead of failing obscurely', async () => {
    const client = stubClient({ failWith: new Error('connect ECONNREFUSED 127.0.0.1:8545') });
    await expect(verifyChainIdentity(client, config)).rejects.toThrow(/cannot reach RPC/);
  });
});

describe('verifyDeploymentPresent', () => {
  it('passes when all three root contracts have code', async () => {
    await expect(verifyDeploymentPresent(stubClient(), config)).resolves.toEqual({
      registry: true,
      factory: true,
      stablecoin: true,
    });
  });

  it('names every missing address and how to fix it', async () => {
    const client = stubClient({
      code: {
        [TEST_ADDRESSES.registry.toLowerCase()]: false,
        [TEST_ADDRESSES.musd.toLowerCase()]: false,
      },
    });
    const error = await verifyDeploymentPresent(client, config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).message).toContain('REGISTRY_ADDRESS');
    expect((error as StartupError).message).toContain('MUSD_ADDRESS');
    expect((error as StartupError).message).not.toContain('FACTORY_ADDRESS');
    expect((error as StartupError).hint).toContain('DeployLocal');
  });
});

describe('registerChain', () => {
  it('records the chain on first run and is idempotent afterwards', async () => {
    await registerChain(db, config);
    await registerChain(db, config);

    const row = await db.one<{ chain_id: bigint; registry_address: string; name: string }>(
      'SELECT chain_id, registry_address, name FROM chains',
    );
    expect(Number(row.chain_id)).toBe(31337);
    expect(row.name).toBe('Anvil');
    expect(row.registry_address).toBe(TEST_ADDRESSES.registry.toLowerCase());
  });

  it('refuses a database holding a different deployment for the same chain id', async () => {
    await registerChain(db, config);

    const redeployed = testConfig({
      REGISTRY_ADDRESS: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    });
    const error = await registerChain(db, redeployed).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).message).toContain('different deployment');
    expect((error as StartupError).message).toContain('REGISTRY_ADDRESS');
    expect((error as StartupError).hint).toContain('db:reset');
  });

  it('still allows confirmations to be retuned without a reset', async () => {
    await registerChain(db, config);
    await registerChain(db, testConfig({ CONFIRMATIONS: '3' }));

    const row = await db.one<{ finality_confirmations: number }>(
      'SELECT finality_confirmations FROM chains',
    );
    expect(row.finality_confirmations).toBe(3);
  });
});

describe('inspectCursor', () => {
  beforeEach(async () => {
    await registerChain(db, config);
  });

  it('reports no-cursor before the first block is indexed', async () => {
    await expect(inspectCursor(db, stubClient(), config)).resolves.toEqual({ kind: 'no-cursor' });
  });

  it('reports ok when the stored hash still matches the chain', async () => {
    await seedCursor(db, 42, hash('a'));
    const state = await inspectCursor(db, stubClient({ blocks: { '42': hash('a') } }), config);
    expect(state).toMatchObject({ kind: 'ok', blockNumber: 42n, worker: 'arc-events' });
  });

  it('reports a reorg when the hash changed but the deployment is still there', async () => {
    await seedCursor(db, 42, hash('a'));
    const state = await inspectCursor(db, stubClient({ blocks: { '42': hash('b') } }), config);
    expect(state).toMatchObject({ kind: 'reorg', blockNumber: 42n, storedHash: hash('a') });
  });

  it('reports a replaced chain when the hash changed and the registry has no code', async () => {
    // The fresh-Anvil case from Boundary B section 5: every address is different now, so
    // continuing would index a new chain into an old chain's history.
    await seedCursor(db, 42, hash('a'));
    const client = stubClient({
      blocks: {},
      code: { [TEST_ADDRESSES.registry.toLowerCase()]: false },
    });
    const state = await inspectCursor(db, client, config);
    expect(state).toMatchObject({ kind: 'restarted', blockNumber: 42n });
  });
});

describe('assertChainReady', () => {
  it('completes the startup sequence on a healthy chain', async () => {
    const report = await assertChainReady(db, stubClient({ latestBlock: 120n }), config);
    expect(report).toMatchObject({
      configuredChainId: 31337,
      rpcChainId: 31337,
      latestBlock: 120n,
      cursorState: { kind: 'no-cursor' },
    });
  });

  it('refuses to run after the chain was replaced, and says how to recover', async () => {
    await registerChain(db, config);
    await seedCursor(db, 42, hash('a'));

    const client = stubClient({
      blocks: {},
      code: { [TEST_ADDRESSES.registry.toLowerCase()]: false },
    });

    const error = await assertChainReady(db, client, config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StartupError);
    // verifyDeploymentPresent trips first: no registry code is already fatal.
    expect((error as StartupError).hint).toContain('DeployLocal');
  });

  it('does not refuse an ordinary reorg, which Milestone B resolves by rollback', async () => {
    await registerChain(db, config);
    await seedCursor(db, 42, hash('a'));

    const report = await assertChainReady(db, stubClient({ blocks: { '42': hash('b') } }), config);
    expect(report.cursorState.kind).toBe('reorg');
  });
});

async function seedCursor(db: Database, blockNumber: number, blockHash: string): Promise<void> {
  await db.query(
    `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
     VALUES (31337, 'arc-events', $1, $2, 1786932000)`,
    [blockNumber, blockHash],
  );
}
