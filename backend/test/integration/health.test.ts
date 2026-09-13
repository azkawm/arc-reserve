import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig } from '../helpers/chain.js';
import { registerChain } from '../../src/chain/identity.js';
import { resetRiskWarnings } from '../../src/observability/health.js';
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
  resetRiskWarnings();
});

const ASSET = `0x${'a7'.repeat(32)}`;
const POOL = '0x75537828f2ce51be7289709686a69cbfdbb714f1';

/** A second chain's own registry. Distinct on purpose: registries are per chain. */
const OTHER_REGISTRY = `0x${'b1'.repeat(20)}`;

/** The same asset id on a second chain, with that chain's own root addresses. */
async function seedOtherChainAsset(
  chainId: number,
  navUpdatedAt: number,
  registry: string,
): Promise<void> {
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'other', 1, $2, $3, $4, 0)`,
    [chainId, registry, `0x${'b2'.repeat(20)}`, `0x${'b3'.repeat(20)}`],
  );
  await db.query(
    `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri, metadata_hash,
                         maturity_timestamp, status, current_nav, nav_updated_at, submitted_block,
                         submitted_at, updated_block)
     VALUES ($1, $2, $3, 'Solar Indonesia 01', 'Renewable energy', 'ipfs://x', $4, 0, 2,
             1000000, $5, 1, 1, 1)`,
    [chainId, ASSET, `0x${'f3'.repeat(20)}`, `0x${'cd'.repeat(32)}`, navUpdatedAt],
  );
}

/** An asset with a published NAV and, optionally, one traded price to compare against it. */
async function seedAsset(navUpdatedAt: number, lastPriceRaw?: bigint): Promise<void> {
  await db.query(
    `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri, metadata_hash,
                         maturity_timestamp, status, current_nav, nav_updated_at, submitted_block,
                         submitted_at, updated_block)
     VALUES (31337, $1, $2, 'Solar Indonesia 01', 'Renewable energy', 'ipfs://x', $3, 0, 2,
             1000000, $4, 1, 1, 1)`,
    [ASSET, `0x${'f3'.repeat(20)}`, `0x${'cd'.repeat(32)}`, navUpdatedAt],
  );
  await db.query(
    `INSERT INTO asset_deployments (chain_id, asset_id, token, vault, offering, market_manager,
                                    revenue_distributor, redemption_controller, pool, deployed_block)
     VALUES (31337, $1, $2, $3, $4, $5, $6, $7, $8, 1)`,
    [
      ASSET,
      `0x${'11'.repeat(20)}`,
      `0x${'22'.repeat(20)}`,
      `0x${'33'.repeat(20)}`,
      `0x${'44'.repeat(20)}`,
      `0x${'55'.repeat(20)}`,
      `0x${'66'.repeat(20)}`,
      POOL,
    ],
  );

  if (lastPriceRaw !== undefined) {
    await db.query(
      `INSERT INTO candles (chain_id, pool, interval_seconds, bucket_start, open_raw, high_raw,
                           low_raw, close_raw, volume_asset_raw, volume_stable_raw, trade_count,
                           first_block, first_transaction_index, first_log_index, last_block,
                           last_transaction_index, last_log_index, finalized, source)
       VALUES (31337, $1, 3600, 1786932000, $2, $2, $2, $2, 0, 0, 1, 1, 0, 0, 1, 0, 0, TRUE,
               'canonical_swap')`,
      [POOL, lastPriceRaw.toString()],
    );
  }
}

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

  it('stays healthy when the chain is merely quiet', async () => {
    // Anvil mines only on transactions, so the newest block can be hours old while the
    // indexer is exactly current. That is an idle chain, not a degraded service; the age of
    // the data is reported per response as meta.stale.
    await registerChain(db, config);
    await db.query(
      `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
       VALUES (31337, 'arc-events', 120, $1, $2)`,
      [`0x${'cd'.repeat(32)}`, Math.floor(Date.now() / 1000) - 7200],
    );

    const server = await serve(stubClient({ latestBlock: 120n }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('healthy');
    expect(body.data.indexers[0]?.lagBlocks).toBe(0);
    expect(body.data.indexers[0]?.lagSeconds).toBeGreaterThan(config.STALE_AFTER_SECONDS);
    // The response still declares its own age honestly.
    expect(body.meta.stale).toBe(true);
  });

  it('degrades when the indexer falls behind the chain and stops catching up', async () => {
    await registerChain(db, config);
    await db.query(
      `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp,
                                    updated_at)
       VALUES (31337, 'arc-events', 100, $1, $2, now() - interval '1 hour')`,
      [`0x${'ab'.repeat(32)}`, Math.floor(Date.now() / 1000)],
    );

    const server = await serve(stubClient({ latestBlock: 500n }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('degraded');
    expect(body.data.indexers[0]?.lagBlocks).toBe(400);
  });

  it('degrades when a projection anomaly is open on the chain it indexes', async () => {
    await registerChain(db, config);
    await db.query(
      `INSERT INTO projection_anomalies (chain_id, worker, kind, detail)
       VALUES (31337, 'arc-events', 'allocation_balance_mismatch', '{}'::jsonb)`,
    );

    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('degraded');
    expect(body.data.anomalies.open).toBe(1);
    expect(body.data.anomalies.indexedChain).toBe(1);
  });

  it('reports another chain\'s anomalies without calling itself degraded for them', async () => {
    // The database is shared across chains (D-030) and this process indexes one of them. A dev
    // chain's backlog is real and worth reporting, but it is not this service being unwell —
    // and a red light nobody can act on is how everyone learns to ignore red lights.
    await registerChain(db, config);
    await db.query(
      `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                           factory_address, stablecoin_address, start_block)
       VALUES (84532, 'Base Sepolia', 1, $1, $2, $3, 0)`,
      [
        `0x${'a1'.repeat(20)}`,
        `0x${'b2'.repeat(20)}`,
        `0x${'c3'.repeat(20)}`,
      ],
    );
    await db.query(
      `INSERT INTO projection_anomalies (chain_id, worker, kind, detail)
       VALUES (84532, 'arc-events', 'allocation_balance_mismatch', '{}'::jsonb)`,
    );

    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('healthy');
    expect(body.data.anomalies.indexedChain).toBe(0);
    expect(body.data.anomalies.open).toBe(1);
    expect(body.data.anomalies.byChain).toEqual([{ chainId: 84532, open: 1 }]);
  });

  it('publishes when a NAV lapses, not only that it has', async () => {
    // navStale says the horse has gone; navExpiresAt is what lets someone republish first.
    // Since D-039 nothing on chain reads isNAVStale, so this is the only control there is.
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 3600);

    const server = await serve(stubClient({ reads: { navStaleAfter: 172_800 } }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks).toHaveLength(1);
    const risk = body.data.risks[0]!;
    expect(risk.assetId).toBe(ASSET);
    expect(risk.navStale).toBe(false);
    expect(risk.navExpiresAt).toBe(now - 3600 + 172_800);
    // Never traded, so there is nothing to compare against NAV — null, not zero.
    expect(risk.lastPriceVsNavBps).toBeNull();
  });

  it('marks a NAV stale once its own window has passed', async () => {
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 200_000);

    const server = await serve(stubClient({ reads: { navStaleAfter: 172_800 } }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks[0]!.navStale).toBe(true);
    expect(body.data.risks[0]!.navExpiresAt).toBeLessThan(now);
  });

  it('measures the last traded price against NAV, signed', async () => {
    // NAV 1.000000 and a last trade at 1.094623 — the live Hedera figures — is +946 bps.
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 60, 1_094_623n);

    const server = await serve(stubClient({ reads: { navStaleAfter: 172_800 } }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks[0]!.lastPriceVsNavBps).toBe(946);
  });

  it('reports a chain whose NAV policy it never read as unknown, not as a null deadline', async () => {
    // No stubbed read: the call throws, as an unreachable registry would. A null deadline would
    // read exactly like "this asset has no NAV"; the honest statement is "not computed, and why".
    await registerChain(db, config);
    await seedAsset(Math.floor(Date.now() / 1000) - 60);

    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks).toEqual([]);
    expect(body.data.riskCoverage.computed).toEqual([]);
    expect(body.data.riskCoverage.notComputed).toEqual([
      { chainId: 31337, reason: 'could not read navStaleAfter from the registry on chain 31337' },
    ]);
  });

  it('keeps the NAV policy it last read when a later read fails', async () => {
    // Policy, not state: a relay hiccup on one poll must not blank every deadline on that poll.
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 3600);

    const first = await serve(stubClient({ reads: { navStaleAfter: 172_800 } }));
    const before = envelope.parse((await first.inject({ method: 'GET', url: '/v1/health' })).json());
    await first.close();

    // Same process, same cache: the registry read now fails.
    const second = await serve(stubClient());
    const after = envelope.parse((await second.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(before.data.risks[0]!.navExpiresAt).toBe(now - 3600 + 172_800);
    expect(after.data.risks[0]!.navExpiresAt).toBe(now - 3600 + 172_800);
    expect(after.data.riskCoverage.notComputed).toEqual([]);
  });

  it('computes risk for another chain it can read, and keeps same-id assets apart', async () => {
    // One API URL serves every chain, so risk cannot stop at the indexed chain. The same assetId is
    // seeded on BOTH chains on purpose: nothing guarantees uniqueness across chains, and rows keyed
    // by assetId alone would collapse into one.
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 3600);
    // Chain 84532 gets a client that genuinely IS 84532 — it answers eth_chainId as 84532 and its
    // registry answers navStaleAfter — so both chains are truly computed. (An earlier version
    // borrowed Anvil for this, which only "worked" because nothing verified the endpoint.)
    await seedOtherChainAsset(84532, now - 7200, OTHER_REGISTRY);

    const withBase = testConfig({ RPC_HTTP_URL_84532: 'http://base-sepolia.test' });
    const server = await buildServer({
      config: withBase,
      db,
      client: stubClient({ reads: { navStaleAfter: 172_800 } }),
      clientFactory: () => stubClient({ chainId: 84532, reads: { navStaleAfter: 172_800 } }),
      logger,
      version: '0.1.0',
    });
    app = server;
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.riskCoverage.computed.sort()).toEqual([31337, 84532]);
    expect(body.data.riskCoverage.notComputed).toEqual([]);
    const byChain = new Map(body.data.risks.map((risk) => [risk.chainId, risk]));
    expect(body.data.risks).toHaveLength(2);
    expect(byChain.get(31337)?.assetId).toBe(ASSET);
    expect(byChain.get(84532)?.assetId).toBe(ASSET);
    expect(byChain.get(31337)?.navExpiresAt).toBe(now - 3600 + 172_800);
    expect(byChain.get(84532)?.navExpiresAt).toBe(now - 7200 + 172_800);
  });

  it('names a chain whose RPC answers as a different chain, rather than trusting its numbers', async () => {
    // The one control that must be right cannot take its deadline from the wrong chain.
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 3600);
    await seedOtherChainAsset(84532, now - 7200, OTHER_REGISTRY);

    const server = await buildServer({
      config: testConfig({ RPC_HTTP_URL_84532: 'http://hashio.test' }),
      db,
      client: stubClient({ reads: { navStaleAfter: 172_800 } }),
      clientFactory: () => stubClient({ chainId: 296, reads: { navStaleAfter: 999 } }),
      logger,
      version: '0.1.0',
    });
    app = server;
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks.map((risk) => risk.chainId)).toEqual([31337]);
    expect(body.data.riskCoverage.notComputed).toHaveLength(1);
    expect(body.data.riskCoverage.notComputed[0]!.chainId).toBe(84532);
    expect(body.data.riskCoverage.notComputed[0]!.reason).toContain('answers as chain 296');
  });

  it('names a chain it cannot read instead of leaving its risk out', async () => {
    // No RPC for 84532 in this process. Its asset exists and is at risk just the same; the report
    // must say "not computed here", never imply "nothing to report".
    const now = Math.floor(Date.now() / 1000);
    await registerChain(db, config);
    await seedAsset(now - 3600);
    await seedOtherChainAsset(84532, now - 7200, OTHER_REGISTRY);

    const server = await serve(stubClient({ reads: { navStaleAfter: 172_800 } }));
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.risks.map((risk) => risk.chainId)).toEqual([31337]);
    expect(body.data.riskCoverage.computed).toEqual([31337]);
    expect(body.data.riskCoverage.notComputed).toHaveLength(1);
    expect(body.data.riskCoverage.notComputed[0]!.chainId).toBe(84532);
    expect(body.data.riskCoverage.notComputed[0]!.reason).toContain('RPC_HTTP_URL_84532');
  });

  it('reports pending backfills and degrades while the indexed chain owes one', async () => {
    // A component whose earlier logs are not fetched is served under onchain provenance while
    // incomplete, and no receipt diff sees it when no broadcast record lists it. So it is counted.
    await registerChain(db, config);
    const component = '0x00000000000000000000000000000000000000c1';
    await db.query(
      `INSERT INTO watched_addresses (chain_id, address, kind, discovered_at_block, backfilled)
       VALUES (31337, $1, 'compliance', 42, FALSE), (31337, $1, 'complianceModule', 42, FALSE)`,
      [component],
    );

    const server = await serve(stubClient());
    const owed = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());
    expect(owed.data.status).toBe('degraded');
    // One address under two kinds is one backfill.
    expect(owed.data.pendingBackfills).toEqual([{ chainId: 31337, count: 1 }]);

    await db.query('UPDATE watched_addresses SET backfilled = TRUE WHERE address = $1', [component]);
    const settled = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());
    expect(settled.data.status).toBe('healthy');
    expect(settled.data.pendingBackfills).toEqual([]);
  });

  it('reports rollbacks from the durable record without degrading status', async () => {
    // Recorded outside the cursor row on purpose: a deep rollback deletes the cursor, so a counter
    // kept there is destroyed by the event it counts. A reorg is chain behaviour, not an unwell
    // service, so the verdict stays healthy — the record exists to be seen, not to page.
    await registerChain(db, config);
    for (const [fromBlock, ancestor, blocks, deleted] of [
      [90, 87, 3, true],
      [120, 119, 1, false],
    ] as const) {
      await db.query(
        `INSERT INTO indexer_rollbacks (chain_id, worker, from_block, ancestor_block,
                                        blocks_discarded, logs_discarded, cursor_deleted)
         VALUES (31337, 'arc-events', $1, $2, $3, 0, $4)`,
        [fromBlock, ancestor, blocks, deleted],
      );
    }

    const server = await serve(stubClient());
    const body = envelope.parse((await server.inject({ method: 'GET', url: '/v1/health' })).json());

    expect(body.data.status).toBe('healthy');
    expect(body.data.rollbacks).toHaveLength(1);
    const record = body.data.rollbacks[0]!;
    expect(record.chainId).toBe(31337);
    expect(record.count).toBe(2);
    expect(record.last).toMatchObject({
      fromBlock: 120,
      ancestorBlock: 119,
      blocksDiscarded: 1,
      cursorDeleted: false,
    });
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
