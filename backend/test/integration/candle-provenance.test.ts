import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { toFunctionSelector } from 'viem';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig } from '../helpers/chain.js';
import { resetPoolCanonicalCache } from '../../src/chain/snapshot.js';
import { buildServer } from '../../src/server.js';
import { createLogger } from '../../src/observability/logger.js';
import { applySwapToCandles } from '../../src/candles/aggregate.js';
import { envelopeSchema } from '../../src/api/envelope.js';
import { candlesSchema } from '../../src/api/schemas/assets.js';
import { loadAbi } from '../../src/chain/abis.js';
import type { Database } from '../../src/db/client.js';
import type { ArcPublicClient } from '../../src/chain/client.js';

/**
 * D-019 on the candle route: `source` and `provenance` make different claims.
 *
 * Since contracts task 10 the demo pool emits real canonical `Swap` events, so its candles are
 * truthfully `source: "canonical_swap"`. The price inside those events comes from a linear
 * stand-in, not a market, so the number is still mock and has to be labelled `mock`. The route
 * decides that with the same bytecode check that labels `spot` and `twap`.
 */

const config = testConfig();
const logger = createLogger('silent', false);
const envelope = envelopeSchema(candlesSchema);

const CHAIN = 31337;
const ASSET_ID = `0x${'ab'.repeat(32)}`;
const POOL = '0x75537828f2ce51be7289709686a69cbfdbb714f1';
const ADDRESS = {
  registry: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  factory: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
  musd: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  issuer: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
};

/** Bytecode carrying a test-only setter selector that only the demo pool has. */
function mockPoolBytecode(): string {
  const setter = loadAbi('MockUniswapV3Pool').find(
    (item) => item.type === 'function' && item.name === 'setOracleForTest',
  );
  expect(setter).toBeDefined();
  return `0x6080${toFunctionSelector(setter as never).slice(2)}00`;
}

let db: Database;
let app: FastifyInstance | null = null;

beforeEach(async () => {
  resetPoolCanonicalCache();
  db = await testDatabase();
  await truncateAll(db);

  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'Anvil', 0, $2, $3, $4, 0)`,
    [CHAIN, ADDRESS.registry, ADDRESS.factory, ADDRESS.musd],
  );
  await db.query(
    `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri, metadata_hash,
                         maturity_timestamp, status, submitted_block, submitted_at, updated_block)
     VALUES ($1, $2, $3, 'Solar Indonesia 01', 'Renewable energy', 'ipfs://x', $4, 0, 2, 1, 1, 1)`,
    [CHAIN, ASSET_ID, ADDRESS.issuer, `0x${'cd'.repeat(32)}`],
  );
  await db.query(
    `INSERT INTO asset_deployments (chain_id, asset_id, token, vault, offering, market_manager,
                                    revenue_distributor, redemption_controller, pool, deployed_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
    [
      CHAIN,
      ASSET_ID,
      `0x${'11'.repeat(20)}`,
      `0x${'22'.repeat(20)}`,
      `0x${'33'.repeat(20)}`,
      `0x${'44'.repeat(20)}`,
      `0x${'55'.repeat(20)}`,
      `0x${'66'.repeat(20)}`,
      POOL,
    ],
  );
  await db.query(
    `INSERT INTO indexer_cursors (chain_id, worker, block_number, block_hash, block_timestamp)
     VALUES ($1, 'arc-events', 100, $2, $3)`,
    [CHAIN, `0x${'ef'.repeat(32)}`, Math.floor(Date.now() / 1000)],
  );

  // A canonical candle, exactly as the Swap projector writes it.
  await db.withTransaction((tx) =>
    applySwapToCandles(tx, {
      chainId: CHAIN,
      pool: POOL,
      price: 1_000_302n,
      volumeAsset: 10n ** 18n,
      volumeStable: 1_000_000n,
      blockNumber: 100n,
      transactionIndex: 0,
      logIndex: 0,
      timestamp: 1_786_932_000n,
    }),
  );
});

afterEach(async () => {
  await app?.close();
  app = null;
});

afterAll(async () => {
  await closeTestDatabase();
});

async function candlesWith(client: ArcPublicClient) {
  app = await buildServer({ config, db, client, logger, version: '0.1.0' });
  const response = await app.inject({
    method: 'GET',
    url: `/v1/assets/${ASSET_ID}/candles?interval=3600`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return envelope.parse(response.json());
}

describe('candle provenance follows the pool, not only the event source', () => {
  it('labels real Swap events from the demo pool mock, and keeps the source truthful', async () => {
    const body = await candlesWith(stubClient({ bytecode: { [POOL]: mockPoolBytecode() } }));

    // The events really are canonical Swaps...
    expect(body.data.source).toBe('canonical_swap');
    expect(body.data.candles).toHaveLength(1);
    // ...but the price they carry comes from a stand-in, so the number is mock (D-019).
    expect(body.meta.provenance).toBe('mock');
  });

  it('labels the same candles derived when the pool is a canonical V3 pool', async () => {
    const body = await candlesWith(stubClient({ bytecode: { [POOL]: '0x60806040' } }));
    expect(body.data.source).toBe('canonical_swap');
    expect(body.meta.provenance).toBe('derived');
  });
});
