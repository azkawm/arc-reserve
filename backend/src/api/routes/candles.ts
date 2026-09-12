import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { formatFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../../lib/decimal.js';
import { buildMeta, respond } from '../envelope.js';
import { assetIdParamSchema, chainQuerySchema } from '../schemas/common.js';
import { candlesSchema } from '../schemas/assets.js';
import * as repo from '../repository.js';
import { CANDLE_INTERVALS } from '../../candles/aggregate.js';
import { storeSyntheticCandles } from '../../candles/synthetic.js';
import { poolIsCanonical, readAssetSnapshot } from '../../chain/snapshot.js';
import type { ApiDeps } from './context.js';

/**
 * `GET /v1/assets/:assetId/candles`
 *
 * Two sources, never blended. Real `Swap` logs produce `canonical_swap` candles. Their
 * provenance is `derived` only when the pool is a canonical V3 pool; the Anvil demo pool's swaps
 * are real events priced by a stand-in, so they are served `mock`. Where no swaps have been
 * indexed the route serves the explicitly synthetic series, `source: "mock"`, and only when
 * `ALLOW_MOCK_MARKET_DATA=true`. With the flag off it returns `MOCK_DISABLED` rather than an
 * empty array, because an empty array is indistinguishable from "this asset has never
 * traded", and a chart would draw that as a flat line at zero.
 */
export async function registerCandleRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { db, config, chains } = deps;

  app.get('/v1/assets/:assetId/candles', async (request, reply) => {
    const chainQuery = chainQuerySchema.safeParse(request.query);
    if (!chainQuery.success) throw ApiError.badRequest('invalid chainId', chainQuery.error.issues);
    // The chain is per request (Boundary C `?chainId=`), and so is the client that reads it.
    const { chainId, client, registry } = await chains.resolve(chainQuery.data.chainId);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const query = z
      .object({
        interval: z.coerce
          .number()
          .int()
          .refine(
            (value) => (CANDLE_INTERVALS as readonly number[]).includes(value),
            `interval must be one of ${CANDLE_INTERVALS.join(', ')}`,
          )
          .default(3600),
        from: z.coerce.number().int().nonnegative().optional(),
        to: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
      })
      .safeParse(request.query);
    if (!query.success) throw ApiError.badRequest('invalid query', query.error.issues);

    const assetId = params.data.assetId.toLowerCase();
    const asset = await repo.getAssetRow(db, chainId, assetId);
    if (asset === null) throw ApiError.notFound(`no asset ${assetId} on chain ${chainId}`);

    const deployment = await repo.getDeployment(db, chainId, assetId);
    if (deployment === null || deployment.pool === null) {
      throw ApiError.notFound('asset has no pool');
    }

    const cursor = await repo.loadCursor(db, chainId);
    if (cursor === null) throw new ApiError('INDEXER_BEHIND', 'nothing has been indexed yet');

    const pool = deployment.pool;
    const canonicalPool = await poolIsCanonical(client, pool as `0x${string}`);
    let source = await repo.getCandleSource(db, chainId, pool, query.data.interval);

    if (source === null || source === 'mock') {
      if (!config.ALLOW_MOCK_MARKET_DATA) {
        throw new ApiError(
          'MOCK_DISABLED',
          'no canonical pool swaps have been indexed for this asset, and synthetic market ' +
            'data is disabled. Set ALLOW_MOCK_MARKET_DATA=true to serve a labelled demo series.',
        );
      }

      // Refresh the demo series against the current reference price.
      const snapshot = await readAssetSnapshot(
        client,
        registry,
        {
          assetId,
          token: deployment.token as `0x${string}`,
          vault: deployment.vault as `0x${string}`,
          offering: deployment.offering as `0x${string}`,
          marketManager: deployment.market_manager as `0x${string}`,
          revenueDistributor: deployment.revenue_distributor as `0x${string}`,
          redemptionController: deployment.redemption_controller as `0x${string}`,
          pool: pool as `0x${string}`,
        },
        cursor.blockNumber,
      );

      const reference = snapshot.market?.spotPrice ?? snapshot.registry.nav;

      await db.withTransaction((tx) =>
        storeSyntheticCandles(tx, {
          chainId: chainId,
          pool,
          referencePrice: reference,
          interval: query.data.interval as (typeof CANDLE_INTERVALS)[number],
          buckets: Math.min(query.data.limit, 200),
        }),
      );
      source = 'mock';
    }

    const rows = await repo.getCandles(db, chainId, pool, {
      interval: query.data.interval,
      ...(query.data.from === undefined ? {} : { from: query.data.from }),
      ...(query.data.to === undefined ? {} : { to: query.data.to }),
      limit: query.data.limit,
    });

    const payload = {
      interval: query.data.interval,
      source,
      candles: rows.map((row) => ({
        timestamp: Number(row.bucket_start),
        open: formatFixed(BigInt(row.open_raw), STABLE_DECIMALS),
        high: formatFixed(BigInt(row.high_raw), STABLE_DECIMALS),
        low: formatFixed(BigInt(row.low_raw), STABLE_DECIMALS),
        close: formatFixed(BigInt(row.close_raw), STABLE_DECIMALS),
        volumeAsset: formatFixed(BigInt(row.volume_asset_raw), TOKEN_DECIMALS),
        volumeStable: formatFixed(BigInt(row.volume_stable_raw), STABLE_DECIMALS),
        tradeCount: row.trade_count,
        finalized: row.finalized,
      })),
    };

    return respond(
      reply,
      candlesSchema,
      payload,
      buildMeta({
        chainId: chainId,
        // `source` and `provenance` answer different questions. `source` says where the candle's
        // events came from; `provenance` says whether the price is market data. Real `Swap` events
        // from the demo pool are priced by a linear stand-in, so they stay `canonical_swap` but are
        // `mock` (D-019) - the same bytecode check that already labels `spot` and `twap`.
        provenance: source === 'mock' || !canonicalPool ? 'mock' : 'derived',
        staleAfterSeconds: config.STALE_AFTER_SECONDS,
        cursor,
        latestBlock: await client.getBlockNumber().catch(() => null),
      }),
    );
  });
}
