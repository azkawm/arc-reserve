import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { ingestBlocks } from '../../src/indexer/ingest.js';
import { WatchedSet, persistWatched } from '../../src/indexer/watched.js';
import { loadAbi } from '../../src/chain/abis.js';
import { getSqrtRatioAtTick } from '../../src/lib/tick.js';
import { formatFixed } from '../../src/lib/decimal.js';
import { applySwapToCandles, finalizeCandles, type SwapPoint } from '../../src/candles/aggregate.js';
import { storeSyntheticCandles } from '../../src/candles/synthetic.js';
import type { Database } from '../../src/db/client.js';

/**
 * The candle fold, against a real PostgreSQL — the constraint that a high can never sit below
 * a close is part of the schema, and the upsert's tuple comparisons only exist in SQL.
 */

const CHAIN = 31337;
const POOL = '0x75537828f2ce51be7289709686a69cbfdbb714f1';
const ADDRESS = {
  registry: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  factory: '0x8a791620dd6260079bf849dc5567adc3f2fdc318',
  musd: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
};

let db: Database;

beforeEach(async () => {
  db = await testDatabase();
  await truncateAll(db);
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'Anvil', 0, $2, $3, $4, 0)`,
    [CHAIN, ADDRESS.registry, ADDRESS.factory, ADDRESS.musd],
  );
});

afterAll(async () => {
  await closeTestDatabase();
});

function swap(overrides: Partial<SwapPoint> & { price: bigint; timestamp: bigint }): SwapPoint {
  return {
    chainId: CHAIN,
    pool: POOL,
    volumeAsset: 10n ** 18n,
    volumeStable: 1_000_000n,
    blockNumber: 100n,
    transactionIndex: 0,
    logIndex: 0,
    ...overrides,
  };
}

async function hourly(): Promise<Record<string, string> | null> {
  return db.maybe<Record<string, string>>(
    `SELECT open_raw::text, high_raw::text, low_raw::text, close_raw::text,
            volume_asset_raw::text, volume_stable_raw::text, trade_count::text, source
       FROM candles WHERE interval_seconds = 3600`,
  );
}

describe('applySwapToCandles', () => {
  it('opens a bucket with the first swap in all six intervals', async () => {
    await db.withTransaction((tx) =>
      applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: 1_786_932_000n })),
    );

    const { rows } = await db.query<{ interval_seconds: number }>(
      'SELECT interval_seconds FROM candles ORDER BY interval_seconds',
    );
    expect(rows.map((row) => row.interval_seconds)).toEqual([60, 300, 900, 3600, 14400, 86400]);

    const candle = await hourly();
    expect(candle).toMatchObject({
      open_raw: '1000000',
      high_raw: '1000000',
      low_raw: '1000000',
      close_raw: '1000000',
      trade_count: '1',
      source: 'canonical_swap',
    });
  });

  it('folds later swaps into high, low, close and volume', async () => {
    const base = 1_786_932_000n;
    await db.withTransaction(async (tx) => {
      await applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: base, logIndex: 0 }));
      await applySwapToCandles(tx, swap({ price: 1_050_000n, timestamp: base + 10n, logIndex: 1 }));
      await applySwapToCandles(tx, swap({ price: 900_000n, timestamp: base + 20n, logIndex: 2 }));
      await applySwapToCandles(tx, swap({ price: 980_000n, timestamp: base + 30n, logIndex: 3 }));
    });

    expect(await hourly()).toMatchObject({
      open_raw: '1000000',
      high_raw: '1050000',
      low_raw: '900000',
      close_raw: '980000',
      trade_count: '4',
      volume_stable_raw: '4000000',
    });
  });

  it('is order-independent: replaying out of order converges on the same candle', async () => {
    // Live ingestion is ordered and so is a rebuild, but a fold that silently depended on
    // that would break the first time a range was replayed differently — and the damage
    // would look like a slightly wrong chart rather than a bug.
    const base = 1_786_932_000n;
    const points = [
      swap({ price: 1_000_000n, timestamp: base, logIndex: 0 }),
      swap({ price: 1_050_000n, timestamp: base + 10n, logIndex: 1 }),
      swap({ price: 900_000n, timestamp: base + 20n, logIndex: 2 }),
      swap({ price: 980_000n, timestamp: base + 30n, logIndex: 3 }),
    ];

    await db.withTransaction(async (tx) => {
      for (const point of [points[2]!, points[0]!, points[3]!, points[1]!]) {
        await applySwapToCandles(tx, point);
      }
    });

    expect(await hourly()).toMatchObject({
      open_raw: '1000000',
      high_raw: '1050000',
      low_raw: '900000',
      close_raw: '980000',
      trade_count: '4',
    });
  });

  it('separates buckets that fall either side of an interval boundary', async () => {
    const base = 1_786_932_000n;
    await db.withTransaction(async (tx) => {
      await applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: base, logIndex: 0 }));
      await applySwapToCandles(tx, swap({ price: 1_200_000n, timestamp: base + 3600n, logIndex: 1 }));
    });

    const { rows } = await db.query<{ bucket_start: bigint; close_raw: string }>(
      `SELECT bucket_start, close_raw::text FROM candles
        WHERE interval_seconds = 3600 ORDER BY bucket_start`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.close_raw).toBe('1000000');
    expect(rows[1]!.close_raw).toBe('1200000');

    // The day bucket still holds both.
    const daily = await db.one<{ trade_count: string; high_raw: string }>(
      'SELECT trade_count::text, high_raw::text FROM candles WHERE interval_seconds = 86400',
    );
    expect(daily.trade_count).toBe('2');
    expect(daily.high_raw).toBe('1200000');
  });

  it('rejects an inconsistent candle at the schema level', async () => {
    await expect(
      db.query(
        `INSERT INTO candles (chain_id, pool, interval_seconds, bucket_start, open_raw, high_raw,
                              low_raw, close_raw, first_block, first_transaction_index,
                              first_log_index, last_block, last_transaction_index, last_log_index,
                              source)
         VALUES ($1, $2, 3600, 0, 100, 50, 10, 90, 1, 0, 0, 1, 0, 0, 'mock')`,
        [CHAIN, POOL],
      ),
    ).rejects.toThrow(/candles_ohlc_ordered/);
  });
});

describe('finalizeCandles', () => {
  it('finalizes only buckets that have ended', async () => {
    const base = 1_786_932_000n;
    await db.withTransaction(async (tx) => {
      await applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: base, logIndex: 0 }));
      await applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: base + 3600n, logIndex: 1 }));
      // Safe point sits inside the second hour, so only the first hour is settled.
      await finalizeCandles(tx, CHAIN, POOL, base + 5000n);
    });

    const { rows } = await db.query<{ bucket_start: bigint; finalized: boolean }>(
      `SELECT bucket_start, finalized FROM candles
        WHERE interval_seconds = 3600 ORDER BY bucket_start`,
    );
    expect(rows[0]!.finalized).toBe(true);
    expect(rows[1]!.finalized).toBe(false);
  });
});

describe('storeSyntheticCandles', () => {
  it('writes a labelled demo series', async () => {
    const written = await db.withTransaction((tx) =>
      storeSyntheticCandles(tx, {
        chainId: CHAIN,
        pool: POOL,
        referencePrice: 1_000_000n,
        interval: 3600,
        buckets: 12,
        until: 1_786_932_000n,
      }),
    );

    expect(written).toBe(12);
    const { rows } = await db.query<{ source: string }>(
      'SELECT DISTINCT source FROM candles WHERE interval_seconds = 3600',
    );
    expect(rows).toEqual([{ source: 'mock' }]);
  });

  it('refuses to overwrite a canonical series with a drawing', async () => {
    // Once a real swap exists the synthetic feed has nothing to add, and quietly replacing
    // trades with generated bars would be the worst possible version of D-019.
    await db.withTransaction((tx) =>
      applySwapToCandles(tx, swap({ price: 1_000_000n, timestamp: 1_786_932_000n })),
    );

    const written = await db.withTransaction((tx) =>
      storeSyntheticCandles(tx, {
        chainId: CHAIN,
        pool: POOL,
        referencePrice: 1_000_000n,
        interval: 3600,
        buckets: 12,
        until: 1_786_932_000n,
      }),
    );

    expect(written).toBe(0);
    const { rows } = await db.query<{ source: string }>(
      'SELECT DISTINCT source FROM candles WHERE interval_seconds = 3600',
    );
    expect(rows).toEqual([{ source: 'canonical_swap' }]);
  });

  it('replaces its own previous series rather than accumulating duplicates', async () => {
    const options = {
      chainId: CHAIN,
      pool: POOL,
      referencePrice: 1_000_000n,
      interval: 3600 as const,
      buckets: 12,
      until: 1_786_932_000n,
    };
    await db.withTransaction((tx) => storeSyntheticCandles(tx, options));
    await db.withTransaction((tx) => storeSyntheticCandles(tx, options));

    const count = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM candles WHERE interval_seconds = 3600 AND source = 'mock'",
    );
    expect(count.count).toBe('12');
  });
});

describe('canonical Swap ingestion', () => {
  const ASSET_ID = `0x${'ff'.repeat(32)}`;
  const TOKEN = '0xd8058efe0198ae9dd7d563e1b4938dcbc86a1f81';
  const ISSUER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

  async function seedDeployment(): Promise<WatchedSet> {
    await db.query(
      `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri,
                           metadata_hash, maturity_timestamp, status, submitted_block,
                           submitted_at, updated_block)
       VALUES ($1, $2, $3, 'Solar', 'Energy', 'ipfs://x', $4, 0, 2, 1, 1, 1)`,
      [CHAIN, ASSET_ID, ISSUER, `0x${'ab'.repeat(32)}`],
    );
    await db.query(
      `INSERT INTO asset_deployments (chain_id, asset_id, token, vault, offering, market_manager,
                                      revenue_distributor, redemption_controller, pool,
                                      deployed_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
      [
        CHAIN,
        ASSET_ID,
        TOKEN,
        `0x${'11'.repeat(20)}`,
        `0x${'22'.repeat(20)}`,
        `0x${'33'.repeat(20)}`,
        `0x${'44'.repeat(20)}`,
        `0x${'55'.repeat(20)}`,
        POOL,
      ],
    );

    const watched = new WatchedSet([{ address: POOL as `0x${string}`, kind: 'pool', assetId: ASSET_ID }]);
    await persistWatched(db, CHAIN, { address: POOL as `0x${string}`, kind: 'pool', assetId: ASSET_ID }, 1n);
    return watched;
  }

  function swapLog(sqrtPriceX96: bigint, logIndex: number) {
    const abi = loadAbi('IUniswapV3Pool');
    const topics = encodeEventTopics({
      abi,
      eventName: 'Swap',
      args: { sender: getAddress(ISSUER), recipient: getAddress(ISSUER) },
    }) as `0x${string}`[];

    const data = encodeAbiParameters(
      [
        { type: 'int256' },
        { type: 'int256' },
        { type: 'uint160' },
        { type: 'uint128' },
        { type: 'int24' },
      ],
      // mUSD is token0 for this deployment (0x5fbd... sorts below 0xd805...), so the
      // 6-decimal magnitude belongs on amount0 and the 18-decimal asset leg on amount1.
      [-1_000_000n, 10n ** 18n, sqrtPriceX96, 5_000_000n, 276324],
    );

    return {
      address: POOL,
      topics,
      data,
      blockNumber: 200n,
      blockHash: `0x${'cc'.repeat(32)}` as `0x${string}`,
      transactionHash: `0x${logIndex.toString(16).padStart(2, '0')}${'dd'.repeat(31)}` as `0x${string}`,
      transactionIndex: 0,
      logIndex,
    };
  }

  it('decodes a real Swap and turns it into a priced candle', async () => {
    // The demo pool does not emit this yet. Testing the path against a hand-built canonical
    // log is the difference between "will work on Base Sepolia" and "we think it will".
    const watched = await seedDeployment();
    const block = {
      number: 200n,
      hash: `0x${'cc'.repeat(32)}` as `0x${string}`,
      parentHash: `0x${'bb'.repeat(32)}` as `0x${string}`,
      timestamp: 1_786_932_000n,
    };

    // The asset is token1 here, verified against AssetMarketManager.assetIsToken0(), so the
    // ~1.0 mUSD price sits at +276324 rather than its negation.
    const sqrtPrice = getSqrtRatioAtTick(276324);
    const log = swapLog(sqrtPrice, 0);

    const result = await ingestBlocks(
      db,
      CHAIN,
      watched,
      [block],
      new Map([['200', [log]]]),
    );

    expect(result.logsStored).toBe(1);
    expect(result.logsProjected).toBe(1);

    const swapRow = await db.one<{ price: string; tick: number; sqrt_price_x96: string }>(
      'SELECT price::text, tick, sqrt_price_x96::text FROM pool_swaps',
    );
    expect(swapRow.tick).toBe(276324);
    expect(swapRow.sqrt_price_x96).toBe(sqrtPrice.toString());

    // Ordering is derived from the addresses and matches assetIsToken0() on the live manager.
    const price = Number(formatFixed(BigInt(swapRow.price), 6));
    expect(price).toBeGreaterThan(0.9);
    expect(price).toBeLessThan(1.1);

    const candle = await db.one<{ close_raw: string; trade_count: string; source: string }>(
      'SELECT close_raw::text, trade_count::text, source FROM candles WHERE interval_seconds = 3600',
    );
    expect(candle.close_raw).toBe(swapRow.price);
    expect(candle.trade_count).toBe('1');
    expect(candle.source).toBe('canonical_swap');
  });

  it('counts each swap once, not once per leg', async () => {
    const watched = await seedDeployment();
    const block = {
      number: 200n,
      hash: `0x${'cc'.repeat(32)}` as `0x${string}`,
      parentHash: `0x${'bb'.repeat(32)}` as `0x${string}`,
      timestamp: 1_786_932_000n,
    };

    await ingestBlocks(db, CHAIN, watched, [block], new Map([
      ['200', [swapLog(getSqrtRatioAtTick(276324), 0), swapLog(getSqrtRatioAtTick(276000), 1)]],
    ]));

    const candle = await db.one<{ trade_count: string; volume_asset_raw: string }>(
      'SELECT trade_count::text, volume_asset_raw::text FROM candles WHERE interval_seconds = 3600',
    );
    expect(candle.trade_count).toBe('2');
    // One whole asset token per swap, and both legs of a swap are the same trade.
    expect(candle.volume_asset_raw).toBe((2n * 10n ** 18n).toString());
  });
});
