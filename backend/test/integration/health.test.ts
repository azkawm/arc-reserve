import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig } from '../helpers/chain.js';
import { registerChain } from '../../src/chain/identity.js';
import { buildServer } from '../../src/server.js';
import { createLogger } from '../../src/observability/logger.js';
import { envelopeSchema } from '../../src/api/envelope.js';
import { healthSchema } from '../../src/api/schemas/health.js';
import type { Database } from '../../src/db/client.js';
import type { ArcPublicClient } from '../../src/chain/client.js';

const config = testConfig();
const logger = createLogger('silent', false);
const envelope = envelopeSchema(healthSchema);

let db: Database;
let app: FastifyInstance | null = null;

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
});

afterEach(async () => {
  await app?.close();
  app = null;
});

afterAll(async () => {
  await closeTestDatabase();
});

async function serve(client: ArcPublicClient): Promise<FastifyInstance> {
  app = await buildServer({ config, db, client, logger, version: '0.1.0' });
  return app;
}

describe('GET /v1/health', () => {
  it('answers with the documented envelope and a validated payload', async () => {
    await registerChain(db, config);
    const server = await serve(stubClient({ latestBlock: 120n }));

    const response = await server.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = envelope.parse(response.json());
    expect(body.data.status).toBe('healthy');
    expect(body.data.chain).toMatchObject({
      configuredChainId: 31337,
      rpcChainId: 31337,
      latestBlock: 120,
      rpcOk: true,
    });
    expect(body.data.database.connected).toBe(true);
    expect(body.data.chains).toHaveLength(1);
    expect(body.data.chains[0]).toMatchObject({ chainId: 31337, indexedByThisProcess: true });
  });

  it('says nothing is indexed yet rather than implying block 0 is current', async () => {
    await registerChain(db, config);
    const server = await serve(stubClient({ latestBlock: 120n }));

    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.indexers).toEqual([]);
    expect(body.meta).toMatchObject({
      indexedBlock: 0,
      indexedBlockHash: null,
      asOf: null,
      stale: true,
      lagBlocks: 120,
    });
  });

  it('never labels its own operational data as onchain', async () => {
    await registerChain(db, config);
    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());
    expect(body.meta.provenance).toBe('derived');
  });

  it('reports the indexer cursor and its lag once a block is indexed', async () => {
    await registerChain(db, config);
    const blockHash = `0x${'ab'.repeat(32)}`;
    await db.query(
      `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
       VALUES (31337, 'arc-events', 100, $1, $2)`,
      [blockHash, Math.floor(Date.now() / 1000)],
    );

    const server = await serve(stubClient({ latestBlock: 120n }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.indexers).toHaveLength(1);
    expect(body.data.indexers[0]).toMatchObject({
      worker: 'arc-events',
      blockNumber: 100,
      lagBlocks: 20,
      reorgDepth: 0,
    });
    expect(body.meta).toMatchObject({ indexedBlock: 100, indexedBlockHash: blockHash, lagBlocks: 20 });
  });

  it('degrades when a projection anomaly is open', async () => {
    await registerChain(db, config);
    await db.query(
      `INSERT INTO projection_anomalies (chain_id, worker, kind, detail)
       VALUES (31337, 'arc-events', 'allocation_balance_mismatch', '{}'::jsonb)`,
    );

    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('degraded');
    expect(body.data.anomalies.open).toBe(1);
  });

  it('reports unhealthy with 503 when the chain is unreachable', async () => {
    await registerChain(db, config);
    const server = await serve(stubClient({ failWith: new Error('connect ECONNREFUSED') }));

    const response = await server.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(503);
    const body = envelope.parse(response.json());
    expect(body.data.status).toBe('unhealthy');
    expect(body.data.chain.rpcOk).toBe(false);
    expect(body.data.chain.error).toContain('ECONNREFUSED');
    // Still an envelope, still honest: the operator gets the detail, not an opaque 500.
    expect(body.data.database.connected).toBe(true);
  });

  it('does not leak the connection string or RPC URL', async () => {
    await registerChain(db, config);
    const server = await serve(stubClient());
    const raw = (await server.inject({ method: 'GET', url: '/v1/health' })).body;
    expect(raw).not.toContain('postgresql://');
    expect(raw).not.toContain('8545');
  });
});

describe('routing', () => {
  it('returns the error envelope for an unknown route', async () => {
    const server = await serve(stubClient());
    const response = await server.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});
