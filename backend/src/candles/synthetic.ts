import { keccak256, toHex } from 'viem';
import type { Queryable } from '../db/client.js';
import { mulDiv } from '../lib/decimal.js';
import { bucketStart, CANDLE_INTERVALS, type CandleInterval } from './aggregate.js';

/**
 * The synthetic demo feed.
 *
 * `MockUniswapV3Pool` is a callback harness: its `swap` does not move `sqrtPriceX96`, and it
 * emits no canonical `Swap`. There is therefore **no price series on Anvil to aggregate**, and
 * anything shown on a chart there is a drawing. This module produces that drawing explicitly
 * so the demo has a chart, under three rules that keep it honest:
 *
 *  1. It runs only when `ALLOW_MOCK_MARKET_DATA=true`. Default is false.
 *  2. Every row it writes carries `source: 'mock'`, and the API refuses to relabel it.
 *  3. It is **deterministic** — seeded from the pool address and bucket time — so it cannot
 *     drift into looking like live discovery, and two people running the demo see the same
 *     shape.
 *
 * It is not a market simulation. There is no order flow, no impact, no liquidity. It is a
 * plausible-looking line around a reference price, and it is labelled as one everywhere it
 * surfaces.
 */

/** ±1.2% around the reference, in basis points. */
const AMPLITUDE_BPS = 120n;
const BPS = 10_000n;

export interface SyntheticOptions {
  chainId: number;
  pool: string;
  /** Reference the series oscillates around — NAV or the manager's spot, 6 decimals. */
  referencePrice: bigint;
  interval: CandleInterval;
  /** Bucket count, newest last. */
  buckets: number;
  /** Newest bucket end; defaults to now. */
  until?: bigint;
}

export interface SyntheticCandle {
  bucketStart: bigint;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volumeAsset: bigint;
  volumeStable: bigint;
  tradeCount: number;
}

/**
 * A deterministic value in [-1, 1] scaled by 1e6, from keccak(pool, bucket). Using a hash
 * rather than `Math.random` is what makes the series reproducible — and keeps a float out of
 * the price path entirely.
 */
function wobble(pool: string, bucket: bigint, salt: string): bigint {
  const digest = keccak256(toHex(`${pool.toLowerCase()}:${bucket.toString()}:${salt}`));
  // Take 8 bytes, map to [0, 2^64), then centre on zero and scale to ±1e6.
  const sample = BigInt(`0x${digest.slice(2, 18)}`);
  const centred = sample - (1n << 63n);
  return mulDiv(centred, 1_000_000n, 1n << 63n);
}

export function generateSyntheticCandles(options: SyntheticOptions): SyntheticCandle[] {
  const { chainId, pool, referencePrice, interval, buckets } = options;
  void chainId;

  if (referencePrice <= 0n) return [];

  const until = options.until ?? BigInt(Math.floor(Date.now() / 1000));
  const newest = bucketStart(until, interval);
  const candles: SyntheticCandle[] = [];

  let previousClose = referencePrice;

  for (let index = buckets - 1; index >= 0; index -= 1) {
    const start = newest - BigInt(index) * BigInt(interval);

    const drift = wobble(pool, start, 'drift');
    const spread = wobble(pool, start, 'spread');

    // close = reference * (1 + drift * amplitude), all in integers.
    const offset = mulDiv(mulDiv(referencePrice, AMPLITUDE_BPS, BPS), drift, 1_000_000n);
    const close = maxBigint(referencePrice + offset, 1n);
    const open = previousClose;

    const halfRange = mulDiv(
      mulDiv(referencePrice, AMPLITUDE_BPS / 3n, BPS),
      absolute(spread),
      1_000_000n,
    );

    const high = maxBigint(maxBigint(open, close) + halfRange, maxBigint(open, close));
    const low = maxBigint(minBigint(open, close) - halfRange, 1n);

    // Volume is derived from the same seed so it moves with the bar rather than independently.
    const tradeCount = Number(absolute(wobble(pool, start, 'trades')) % 12n) + 1;
    const volumeStable = mulDiv(referencePrice, BigInt(tradeCount) * 250n, 1n);
    const volumeAsset = close === 0n ? 0n : mulDiv(volumeStable, 10n ** 18n, close);

    candles.push({
      bucketStart: start,
      open,
      high,
      low,
      close,
      volumeAsset,
      volumeStable,
      tradeCount,
    });

    previousClose = close;
  }

  return candles;
}

/**
 * Write a synthetic series, replacing any previous synthetic rows for that pool and interval.
 *
 * Canonical rows are never touched: if a real `Swap` has ever been indexed for this pool, the
 * synthetic feed has nothing to add and refuses to overwrite history with a drawing.
 */
export async function storeSyntheticCandles(
  tx: Queryable,
  options: SyntheticOptions,
): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM candles
      WHERE chain_id = $1 AND pool = $2 AND source = 'canonical_swap'`,
    [options.chainId, options.pool],
  );
  if (Number(rows[0]?.count ?? '0') > 0) return 0;

  const candles = generateSyntheticCandles(options);
  if (candles.length === 0) return 0;

  await tx.query(
    `DELETE FROM candles WHERE chain_id = $1 AND pool = $2 AND interval_seconds = $3
       AND source = 'mock'`,
    [options.chainId, options.pool, options.interval],
  );

  for (const candle of candles) {
    await tx.query(
      `INSERT INTO candles (
          chain_id, pool, interval_seconds, bucket_start,
          open_raw, high_raw, low_raw, close_raw,
          volume_asset_raw, volume_stable_raw, trade_count,
          first_block, first_transaction_index, first_log_index,
          last_block, last_transaction_index, last_log_index,
          finalized, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, 0, 0, 0, TRUE, 'mock')`,
      [
        options.chainId,
        options.pool,
        options.interval,
        candle.bucketStart.toString(),
        candle.open.toString(),
        candle.high.toString(),
        candle.low.toString(),
        candle.close.toString(),
        candle.volumeAsset.toString(),
        candle.volumeStable.toString(),
        candle.tradeCount,
      ],
    );
  }

  return candles.length;
}

export const SYNTHETIC_INTERVALS = CANDLE_INTERVALS;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
