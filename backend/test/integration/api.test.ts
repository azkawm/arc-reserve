import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getAddress } from 'viem';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { testConfig } from '../helpers/chain.js';
import { ANVIL_RPC_URL, readLocalDeployment, requireAnvil, type LocalDeployment } from '../helpers/anvil.js';
import { createChainClient } from '../../src/chain/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { Indexer } from '../../src/indexer/runner.js';
import { buildServer } from '../../src/server.js';
import { loadAbi } from '../../src/chain/abis.js';
import { envelopeSchema } from '../../src/api/envelope.js';
import {
  activitySchema,
  assetDetailSchema,
  assetListSchema,
  metricsSchema,
  navHistorySchema,
  positionsSchema,
  redemptionsSchema,
  revenueSchema,
  accountPositionSchema,
  candlesSchema,
} from '../../src/api/schemas/assets.js';
import type { Database } from '../../src/db/client.js';
import type { Config } from '../../src/config.js';
import type { ArcPublicClient } from '../../src/chain/client.js';

/**
 * Milestone C acceptance: every `/v1` route answers with the shape Boundary C promises, and
 * every number in it agrees with the chain.
 *
 * The assertions compare against the contracts' own views rather than literals wherever a
 * value exists onchain. The settlement split has changed twice this week (70/20/10 →
 * 65/30/5); a test that hardcoded the resulting amounts would be measuring the document, not
 * the system.
 */

const logger = createLogger('silent', false);

let deployment: LocalDeployment;
let config: Config;
let client: ArcPublicClient;
let db: Database;
let app: FastifyInstance;

beforeAll(async () => {
  deployment = readLocalDeployment();
  await requireAnvil(deployment);

  config = testConfig({
    RPC_HTTP_URL: ANVIL_RPC_URL,
    REGISTRY_ADDRESS: deployment.registry,
    FACTORY_ADDRESS: deployment.factory,
    MUSD_ADDRESS: deployment.mockUSD,
    COMPANY_VESTING_ADDRESS: '',
  });

  client = createChainClient(config);
  db = await testDatabase();
  await truncateAll(db);
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'Anvil', 0, $2, $3, $4, 0)`,
    [config.CHAIN_ID, config.addresses.registry, config.addresses.factory, config.addresses.stablecoin],
  );

  const indexer = new Indexer({ config, db, client, logger });
  await indexer.prepare();
  await indexer.syncToHead();

  app = await buildServer({ config, db, client, logger, version: '0.1.0' });
});

afterAll(async () => {
  await app?.close();
  await closeTestDatabase();
});

async function get<T extends Parameters<typeof envelopeSchema>[0]>(url: string, schema: T) {
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode, `${url} -> ${response.body}`).toBe(200);
  return envelopeSchema(schema).parse(response.json());
}

async function view<T>(address: string, abi: Parameters<typeof loadAbi>[0], fn: string, args: unknown[] = []) {
  return client.readContract({
    address: getAddress(address),
    abi: loadAbi(abi),
    functionName: fn,
    args,
  }) as Promise<T>;
}

describe('GET /v1/assets', () => {
  it('lists the seeded asset with its discovered component addresses', async () => {
    const body = await get('/v1/assets', assetListSchema);

    expect(body.data).toHaveLength(1);
    const item = body.data[0]!;
    expect(item.assetId).toBe(deployment.assetId.toLowerCase());
    expect(item.name).toBe('Solar Indonesia 01');
    expect(item.symbol).toBe('SOLAR01');
    expect(item.slug).toBe('solar-indonesia-01');
    expect(item.status).toBe('Active');
    expect(item.contracts?.token).toBe(getAddress(deployment.token));
    expect(item.contracts?.pool).toBe(getAddress(deployment.pool));
  });

  it('labels a price from the mock pool as mock, never onchain', async () => {
    // The pool is MockUniswapV3Pool: a callback harness whose price does not move with
    // trading. Publishing that as `onchain` is the silent substitution D-019 forbids.
    const body = await get('/v1/assets', assetListSchema);
    expect(body.data[0]!.spot?.provenance).toBe('mock');
  });

  it('reports change24h as null rather than inventing a zero', async () => {
    const body = await get('/v1/assets', assetListSchema);
    expect(body.data[0]!.change24h).toBeNull();
  });

  it('filters by status and validates an unknown one', async () => {
    const active = await get('/v1/assets?status=Active', assetListSchema);
    expect(active.data).toHaveLength(1);

    const pending = await get('/v1/assets?status=Pending', assetListSchema);
    expect(pending.data).toHaveLength(0);

    const bad = await app.inject({ method: 'GET', url: '/v1/assets?status=Nonsense' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});

describe('GET /v1/assets/:assetId', () => {
  it('returns identity and the metadata commitment', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}`, assetDetailSchema);
    expect(body.data.metadataURI).toContain('ipfs://');
    expect(body.data.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.data.maturity).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('404s an unknown asset with the documented error code', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/assets/0x${'11'.repeat(32)}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });

  it('400s a malformed assetId', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/assets/not-a-hash' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /v1/assets/:assetId/metrics', () => {
  it('agrees with the vault, token and registry views', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const m = body.data;

    const [nav, reserve, totalAccounted, maxSupply, totalSupply, investorSupply, eligible] =
      await Promise.all([
        view<readonly [bigint, bigint]>(deployment.registry, 'AssetRegistry', 'navOf', [deployment.assetId]),
        view<bigint>(deployment.vault, 'AssetVault', 'redemptionReserve'),
        view<bigint>(deployment.vault, 'AssetVault', 'totalAccounted'),
        view<bigint>(deployment.token, 'AssetToken', 'maximumSupply'),
        view<bigint>(deployment.token, 'AssetToken', 'totalSupply'),
        view<bigint>(deployment.token, 'AssetToken', 'investorSupply'),
        view<bigint>(deployment.revenueDistributor, 'RevenueDistributor', 'yieldEligibleSupply'),
      ]);

    expect(m.nav.raw).toBe(nav[0].toString());
    expect(m.nav.timestamp).toBe(Number(nav[1]));
    expect(m.reserve.redemptionReserve).toBe(format(reserve, 6));
    expect(m.reserve.totalAccounted).toBe(format(totalAccounted, 6));
    expect(m.supply.maximum).toBe(format(maxSupply, 18));
    expect(m.supply.issued).toBe(format(totalSupply, 18));
    expect(m.supply.investor).toBe(format(investorSupply, 18));
    expect(m.supply.eligibleCirculating).toBe(format(eligible, 18));
    expect(m.supply.headroom).toBe(format(maxSupply - totalSupply, 18));
  });

  it('keeps NAV, floor and redemption price as separate values (D-009)', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const m = body.data;

    const onChainNormal = await view<bigint>(
      deployment.redemptionController,
      'RedemptionController',
      'redemptionPrice',
      [0],
    );

    expect(m.redemptionPrice.normal).toBe(format(onChainNormal, 6));
    expect(m.floorReference.formula).toContain('min(nav');
    // Distinct fields, even when their current values coincide.
    expect(Object.keys(m)).toEqual(expect.arrayContaining(['nav', 'spot', 'twap', 'floorReference', 'redemptionPrice']));
  });

  it('reads the offering configuration that no event carries', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const [price, cap, walletLimit, minimum, startsAt, endsAt] = await Promise.all([
      view<bigint>(deployment.offering, 'PrimaryOffering', 'tokenPrice'),
      view<bigint>(deployment.offering, 'PrimaryOffering', 'fundraisingCap'),
      view<bigint>(deployment.offering, 'PrimaryOffering', 'walletPurchaseLimit'),
      view<bigint>(deployment.offering, 'PrimaryOffering', 'minimumPurchase'),
      view<bigint>(deployment.offering, 'PrimaryOffering', 'startsAt'),
      view<bigint>(deployment.offering, 'PrimaryOffering', 'endsAt'),
    ]);

    expect(body.data.offering.price).toBe(format(price, 6));
    expect(body.data.offering.cap).toBe(format(cap, 6));
    expect(body.data.offering.walletLimit).toBe(format(walletLimit, 6));
    expect(body.data.offering.minimumPurchase).toBe(format(minimum, 6));
    expect(body.data.offering.startsAt).toBe(Number(startsAt));
    expect(body.data.offering.endsAt).toBe(Number(endsAt));
  });

  it('computes offering openness and NAV staleness at request time', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const stale = await view<boolean>(deployment.registry, 'AssetRegistry', 'isNAVStale', [
      deployment.assetId,
    ]);
    expect(body.data.nav.stale).toBe(stale);
    expect(typeof body.data.offering.open).toBe('boolean');
  });

  it('publishes when the NAV lapses, not only whether it has', async () => {
    // Every keeper and liquidity path is blocked the moment a NAV goes stale, so the deadline
    // is what lets a UI warn beforehand. `navStaleAfter` is a uint32, which viem hands back as
    // a number: adding it to the bigint timestamp without saying so throws at request time.
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const staleAfter = await view<number>(deployment.registry, 'AssetRegistry', 'navStaleAfter');

    const expiresAt = body.data.nav.expiresAt;
    expect(body.data.nav.staleAfterSeconds).toBe(Number(staleAfter));
    expect(expiresAt).not.toBeNull();
    expect(expiresAt).toBe(body.data.nav.timestamp + Number(staleAfter));
    expect(body.data.nav.stale).toBe((expiresAt ?? 0) <= Math.floor(Date.now() / 1000));
  });

  it('says the market is ready rather than merely not broken', async () => {
    // Three distinct states: prices live, pool warming up (its TWAP window is not covered yet
    // and the price views revert on a timer), or genuinely unavailable. The demo pool answers
    // immediately, so this deployment is ready.
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    expect(body.data.marketStatus).toBe('ready');
    expect(body.data.spot).not.toBeNull();
  });

  it('exposes the D-023 reserve schedule with a target that moves with time', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const schedule = body.data.reserveSchedule;
    if (schedule === null) return; // deployment without a schedule

    const [targetNow, currentBacking, behind] = await Promise.all([
      view<bigint>(deployment.vault, 'AssetVault', 'targetBackingNow'),
      view<bigint>(deployment.vault, 'AssetVault', 'currentBacking'),
      view<boolean>(deployment.vault, 'AssetVault', 'isBehindSchedule'),
    ]);

    expect(schedule.targetBackingNow).toBe(format(targetNow, 6));
    expect(schedule.currentBacking).toBe(format(currentBacking, 6));
    expect(schedule.behindSchedule).toBe(behind);
  });

  it('reports no vesting allocation (D-031)', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    expect(body.data.supply.vesting).toBeNull();
  });
});

describe('GET /v1/assets/:assetId/positions', () => {
  it('converts ticks to prices and leaves liquidity a raw uint128', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/positions`, positionsSchema);
    expect(body.data.positions).toHaveLength(4);

    const anchor = body.data.positions.find((p) => p.kind === 'Anchor')!;
    expect(anchor.configured).toBe(true);

    const onChain = await view<readonly [number, number, bigint, boolean]>(
      deployment.marketManager,
      'AssetMarketManager',
      'positions',
      [1],
    );
    expect(anchor.tickLower).toBe(onChain[0]);
    expect(anchor.tickUpper).toBe(onChain[1]);
    expect(anchor.liquidity).toBe(onChain[2].toString());

    // Prices are ordered and near the 1.0 mUSD seed, not raw tick integers.
    expect(Number(anchor.priceLower)).toBeLessThan(Number(anchor.priceUpper));
    expect(Number(anchor.priceLower)).toBeGreaterThan(0.5);
    expect(Number(anchor.priceUpper)).toBeLessThan(2);
  });

  it('does not publish per-position token amounts', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/positions`, positionsSchema);
    for (const position of body.data.positions) {
      expect(position).not.toHaveProperty('amount0');
      expect(position).not.toHaveProperty('balanceStable');
    }
  });
});

describe('GET /v1/assets/:assetId/activity', () => {
  it('returns a decoded timeline in reverse chain order', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/activity?limit=20`, activitySchema);
    expect(body.data.length).toBeGreaterThan(0);

    for (let i = 1; i < body.data.length; i += 1) {
      const previous = body.data[i - 1]!;
      const current = body.data[i]!;
      expect(
        previous.blockNumber > current.blockNumber ||
          (previous.blockNumber === current.blockNumber && previous.logIndex > current.logIndex),
      ).toBe(true);
    }

    const types = new Set(body.data.map((item) => item.type));
    expect(types.has('StatusChange') || types.has('NAVUpdate') || types.has('ReserveDeposit')).toBe(
      true,
    );
  });

  it('formats amounts as decimal strings, not base units', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/activity?limit=50`, activitySchema);
    const reserveDeposit = body.data.find((item) => item.type === 'ReserveDeposit');
    if (reserveDeposit !== undefined) {
      expect(String(reserveDeposit.summary.amount)).toMatch(/^\d+\.\d{6}$/);
    }
  });

  it('filters by type', async () => {
    const body = await get(
      `/v1/assets/${deployment.assetId}/activity?type=NAVUpdate`,
      activitySchema,
    );
    for (const item of body.data) expect(item.type).toBe('NAVUpdate');
  });
});

describe('GET /v1/assets/:assetId/nav-history', () => {
  it('returns the NAV series with its own timestamps', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/nav-history`, navHistorySchema);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]!.nav).toMatch(/^\d+\.\d{6}$/);
  });
});

describe('GET /v1/assets/:assetId/revenue and /redemptions', () => {
  it('reports revenue totals consistent with the distributor', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/revenue`, revenueSchema);
    const claimed = await view<bigint>(
      deployment.revenueDistributor,
      'RevenueDistributor',
      'totalClaimed',
    );
    expect(body.data.totalClaimed).toBe(format(claimed, 6));
  });

  it('reports the redemption period from the controller', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/redemptions`, redemptionsSchema);
    const [limit, redeemed] = await Promise.all([
      view<bigint>(deployment.redemptionController, 'RedemptionController', 'periodLimitTokens'),
      view<bigint>(deployment.redemptionController, 'RedemptionController', 'redeemedThisPeriod'),
    ]);
    expect(body.data.currentPeriod.limit).toBe(format(limit, 18));
    expect(body.data.currentPeriod.redeemed).toBe(format(redeemed, 18));
  });
});

describe('GET /v1/accounts/:address/assets/:assetId', () => {
  const investor = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  it('reports a verified holder and recomputes verification from the claim', async () => {
    const body = await get(
      `/v1/accounts/${investor}/assets/${deployment.assetId}`,
      accountPositionSchema,
    );

    const onChain = await view<boolean>(deployment.identityRegistry, 'IdentityRegistry', 'isVerified', [
      getAddress(investor),
    ]);
    expect(body.data.verified).toBe(onChain);
    expect(body.data.identity?.country).toBe(360);
  });

  it('agrees with balanceOf and claimableRevenue', async () => {
    const body = await get(
      `/v1/accounts/${investor}/assets/${deployment.assetId}`,
      accountPositionSchema,
    );
    const [balance, claimable] = await Promise.all([
      view<bigint>(deployment.token, 'AssetToken', 'balanceOf', [getAddress(investor)]),
      view<bigint>(deployment.revenueDistributor, 'RevenueDistributor', 'claimableRevenue', [
        getAddress(investor),
      ]),
    ]);
    expect(body.data.tokenBalance).toBe(format(balance, 18));
    expect(body.data.claimable).toBe(format(claimable, 6));
  });

  it('reports a zero position for an unknown wallet instead of 404', async () => {
    const body = await get(
      `/v1/accounts/0x${'22'.repeat(20)}/assets/${deployment.assetId}`,
      accountPositionSchema,
    );
    expect(body.data.tokenBalance).toBe('0.000000000000000000');
    expect(body.data.verified).toBe(false);
    expect(body.data.claimable).toBe('0.000000');
  });
});

describe('the envelope', () => {
  it('carries the indexed block and its hash on every route', async () => {
    for (const [url, schema] of [
      ['/v1/assets', assetListSchema],
      [`/v1/assets/${deployment.assetId}`, assetDetailSchema],
      [`/v1/assets/${deployment.assetId}/metrics`, metricsSchema],
      [`/v1/assets/${deployment.assetId}/positions`, positionsSchema],
      [`/v1/assets/${deployment.assetId}/activity`, activitySchema],
    ] as const) {
      const body = await get(url, schema);
      expect(body.meta.chainId).toBe(31337);
      expect(body.meta.indexedBlock).toBeGreaterThan(0);
      expect(body.meta.indexedBlockHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(body.meta.provenance).toBe('onchain');
    }
  });

  it('never emits a JSON number for a financial quantity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/assets/${deployment.assetId}/metrics`,
    });
    const raw = response.body;
    // Every money field is quoted. An unquoted decimal would mean a float reached JSON.
    expect(raw).not.toMatch(/"redemptionReserve":\s*[0-9]/);
    expect(raw).toMatch(/"redemptionReserve":\s*"\d+\.\d{6}"/);
  });
});

function format(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const body = `${absolute / base}.${(absolute % base).toString().padStart(decimals, '0')}`;
  return negative ? `-${body}` : body;
}

describe('GET /v1/assets/:assetId/candles', () => {
  it('refuses to serve a chart rather than fabricating one, when mock data is off', async () => {
    // The default. No canonical pool has ever emitted a Swap here, so there is genuinely no
    // price series — and an empty array would be indistinguishable from "never traded",
    // which a chart draws as a flat line at zero.
    const response = await app.inject({
      method: 'GET',
      url: `/v1/assets/${deployment.assetId}/candles?interval=3600`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'MOCK_DISABLED' } });
  });

  it('rejects an interval outside the six documented ones', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/assets/${deployment.assetId}/candles?interval=120`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('serves a labelled synthetic series when mock data is explicitly enabled', async () => {
    const mockConfig = testConfig({
      RPC_HTTP_URL: ANVIL_RPC_URL,
      REGISTRY_ADDRESS: deployment.registry,
      FACTORY_ADDRESS: deployment.factory,
      MUSD_ADDRESS: deployment.mockUSD,
      COMPANY_VESTING_ADDRESS: '',
      ALLOW_MOCK_MARKET_DATA: 'true',
    });

    const mockApp = await buildServer({
      config: mockConfig,
      db,
      client,
      logger,
      version: '0.1.0',
    });

    try {
      const response = await mockApp.inject({
        method: 'GET',
        url: `/v1/assets/${deployment.assetId}/candles?interval=3600&limit=24`,
      });
      expect(response.statusCode).toBe(200);

      const body = envelopeSchema(candlesSchema).parse(response.json());
      expect(body.data.source).toBe('mock');
      // The envelope agrees: nothing here is derived from chain activity.
      expect(body.meta.provenance).toBe('mock');
      expect(body.data.candles.length).toBeGreaterThan(0);

      for (const candle of body.data.candles) {
        expect(Number(candle.high)).toBeGreaterThanOrEqual(Number(candle.low));
        expect(candle.open).toMatch(/^\d+\.\d{6}$/);
        expect(candle.volumeAsset).toMatch(/^\d+\.\d{18}$/);
      }

      // Buckets are on the hour grid and ascending.
      const timestamps = body.data.candles.map((c) => c.timestamp);
      for (let i = 1; i < timestamps.length; i += 1) {
        expect(timestamps[i]! - timestamps[i - 1]!).toBe(3600);
        expect(timestamps[i]! % 3600).toBe(0);
      }
    } finally {
      await mockApp.close();
    }
  });
});

describe('D-025 floor and D-026 term-sheet binding', () => {
  it('publishes the floor level with its coverage flag attached', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    const floor = body.data.floor;
    expect(floor, 'floor block should be present once a FloorController is deployed').not.toBeNull();
    if (floor === null) return;

    const controller = deployment.floorController!;
    const [tick, price, covered, canLevelUp] = await Promise.all([
      view<number>(controller, 'FloorController', 'floorTick'),
      view<bigint>(controller, 'FloorController', 'floorPrice'),
      view<boolean>(controller, 'FloorController', 'isFloorCovered'),
      view<boolean>(controller, 'FloorController', 'canLevelUp'),
    ]);

    expect(floor.tick).toBe(Number(tick));
    expect(floor.price).toBe(format(price, 6));
    expect(floor.covered).toBe(covered);
    expect(floor.canLevelUp).toBe(canLevelUp);
    expect(floor.controller).toBe(getAddress(controller));
  });

  it('keeps coverage inside the floor object so it cannot be rendered without it', async () => {
    // isFloorCovered() can go false with no event and no state change — a NAV markdown can
    // leave a valid level above the new NAV. A floor shown without this flag asserts
    // something the contract does not.
    const body = await get(`/v1/assets/${deployment.assetId}/metrics`, metricsSchema);
    if (body.data.floor === null) return;
    expect(Object.keys(body.data.floor)).toContain('covered');
    expect(body.data).not.toHaveProperty('floorCovered');
  });

  it('publishes the term-sheet hash the deployment was bound to', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}`, assetDetailSchema);
    const onChain = await view<string>(deployment.registry, 'AssetRegistry', 'termsHashOf', [
      deployment.assetId,
    ]);
    expect(body.data.termsHash).toBe(onChain.toLowerCase());
    expect(body.data.termsHash).not.toBe(`0x${'00'.repeat(32)}`);
  });

  it('exposes the floor controller among the contract addresses', async () => {
    const body = await get(`/v1/assets/${deployment.assetId}`, assetDetailSchema);
    expect(body.data.contracts?.floorController).toBe(getAddress(deployment.floorController!));
  });
});
