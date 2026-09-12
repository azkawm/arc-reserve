import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { stubClient, testConfig } from '../helpers/chain.js';
import { buildServer } from '../../src/server.js';
import { createLogger } from '../../src/observability/logger.js';
import { envelopeSchema } from '../../src/api/envelope.js';
import { assetListSchema } from '../../src/api/schemas/assets.js';
import type { Config } from '../../src/config.js';
import type { Database } from '../../src/db/client.js';

/**
 * `?chainId=` (Boundary C section 2). One database holds every chain (D-030), so the read model
 * can answer for a chain this process does not index — but only if the API can also read that
 * chain's contract state. The cases below are the three honest outcomes: serve it, refuse it
 * because nothing indexed it, or refuse it because there is no RPC for it. Answering about the
 * configured chain while labelling the response with the requested one is not among them.
 */

const logger = createLogger('silent', false);
const list = envelopeSchema(assetListSchema);

const ANVIL = 31337;
const BASE_SEPOLIA = 84532;

const ANVIL_ASSET = `0x${'a1'.repeat(32)}`;
const BASE_ASSET = `0x${'b2'.repeat(32)}`;

const ADDRESS = {
  registry: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  factory: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
  musd: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  issuer: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  // Base Sepolia's own deployment, which sorts differently and is a different registry.
  baseRegistry: '0x4e80dbdcb2e054501a0e4d34ca3c1ac535909386',
  baseFactory: '0xafb2329c2331b4e0dbfad1b9784443ed8ba908bb',
  baseMusd: '0xc9b53f30584679a7e19216626751529cf520cab0',
};

let db: Database;
let app: FastifyInstance | null = null;

async function seedChain(
  chainId: number,
  addresses: { registry: string; factory: string; musd: string },
  assetId: string,
  name: string,
): Promise<void> {
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, $2, 0, $3, $4, $5, 0)`,
    [chainId, `chain ${chainId}`, addresses.registry, addresses.factory, addresses.musd],
  );
  await db.query(
    `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri, metadata_hash,
                         maturity_timestamp, status, submitted_block, submitted_at, updated_block)
     VALUES ($1, $2, $3, $4, 'Renewable energy', 'ipfs://x', $5, 0, 2, 1, 1, 1)`,
    [chainId, assetId, ADDRESS.issuer, name, `0x${'cd'.repeat(32)}`],
  );
}

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
  // Deliberately no asset_deployments: the list route then skips the contract reads, so these
  // assertions are about chain selection and nothing else.
  await seedChain(ANVIL, ADDRESS, ANVIL_ASSET, 'Solar Indonesia 01');
  await seedChain(
    BASE_SEPOLIA,
    { registry: ADDRESS.baseRegistry, factory: ADDRESS.baseFactory, musd: ADDRESS.baseMusd },
    BASE_ASSET,
    'Solar Indonesia 01 (Base)',
  );
});

afterEach(async () => {
  await app?.close();
  app = null;
});

afterAll(async () => {
  await closeTestDatabase();
});

async function serve(config: Config) {
  app = await buildServer({ config, db, client: stubClient(), logger, version: '0.1.0' });
  return app;
}

async function assets(config: Config, query = '') {
  const server = await serve(config);
  const response = await server.inject({ method: 'GET', url: `/v1/assets${query}` });
  return { status: response.statusCode, json: response.json() as unknown };
}

describe('?chainId= selects the chain', () => {
  it('defaults to the chain this process indexes', async () => {
    const { status, json } = await assets(testConfig());
    expect(status).toBe(200);

    const body = list.parse(json);
    expect(body.meta.chainId).toBe(ANVIL);
    expect(body.data.map((asset) => asset.assetId)).toEqual([ANVIL_ASSET]);
  });

  it('serves another indexed chain when that chain has an RPC configured', async () => {
    // The URL only has to exist: this route reads the head for the envelope and tolerates a
    // failure there, and with no deployment row it makes no contract calls at all.
    const config = testConfig({ RPC_HTTP_URL_84532: 'http://127.0.0.1:8545' });
    const { status, json } = await assets(config, `?chainId=${BASE_SEPOLIA}`);
    expect(status).toBe(200);

    const body = list.parse(json);
    expect(body.meta.chainId).toBe(BASE_SEPOLIA);
    expect(body.data.map((asset) => asset.assetId)).toEqual([BASE_ASSET]);
    // The configured chain's asset is not reachable from the other chain's response.
    expect(body.data.map((asset) => asset.assetId)).not.toContain(ANVIL_ASSET);
  });

  it('refuses an indexed chain it has no RPC for, rather than reading the wrong chain', async () => {
    const { status, json } = await assets(testConfig(), `?chainId=${BASE_SEPOLIA}`);
    expect(status).toBe(503);
    expect((json as { error: { code: string; message: string } }).error.code).toBe(
      'CHAIN_UNAVAILABLE',
    );
    expect((json as { error: { message: string } }).error.message).toContain('RPC_HTTP_URL_84532');
  });

  it('refuses a supported chain that nothing has indexed, and says what is indexed', async () => {
    const { status, json } = await assets(testConfig(), '?chainId=296');
    expect(status).toBe(400);

    const error = (json as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toContain('has not been indexed');
    expect(error.message).toContain('31337');
  });

  it('refuses a chain that is not a supported testnet (D-027)', async () => {
    const { status, json } = await assets(testConfig(), '?chainId=1');
    expect(status).toBe(400);

    const error = (json as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toContain('testnet only');
  });

  it('refuses a chainId that is not a number at all', async () => {
    const { status, json } = await assets(testConfig(), '?chainId=base');
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });
});
