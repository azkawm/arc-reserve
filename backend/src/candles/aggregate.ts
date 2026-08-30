import type { Queryable } from '../db/client.js';

/**
 * OHLC aggregation.
 *
 * A candle is a fold over the swaps in a time bucket, and the fold is written to be
 * **order-independent**: open and close are decided by comparing the contributing log's
 * `(block, transactionIndex, logIndex)` against the ones already recorded, not by assuming
 * the caller fed them in order. Live ingestion is ordered, and so is a rebuild — but a fold
 * that silently depends on that would break the first time a range was replayed differently,
 * and the failure would look like a mildly wrong chart rather than a bug.
 */

/** BACKEND_INDEXER.md §10. Minute through day. */
export const CANDLE_INTERVALS = [60, 300, 900, 3600, 14400, 86400] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export function isCandleInterval(value: number): value is CandleInterval {
  return (CANDLE_INTERVALS as readonly number[]).includes(value);
}

export type CandleSource = 'canonical_swap' | 'mock';

export interface SwapPoint {
  chainId: number;
  pool: string;
  price: bigint;
  volumeAsset: bigint;
  volumeStable: bigint;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  timestamp: bigint;
}

export function bucketStart(timestamp: bigint, interval: number): bigint {
  const size = BigInt(interval);
  return (timestamp / size) * size;
}

/**
 * Fold one swap into every interval's bucket.
 *
 * Called inside the block's own transaction, so a candle can never be committed without the
 * swap that moved it.
 */
export async function applySwapToCandles(
  tx: Queryable,
  swap: SwapPoint,
  source: CandleSource = 'canonical_swap',
): Promise<void> {
  for (const interval of CANDLE_INTERVALS) {
    await upsertCandle(tx, swap, interval, source);
  }
}

async function upsertCandle(
  tx: Queryable,
  swap: SwapPoint,
  interval: number,
  source: CandleSource,
): Promise<void> {
  const start = bucketStart(swap.timestamp, interval);

  await tx.query(
    `INSERT INTO candles (
        chain_id, pool, interval_seconds, bucket_start,
        open_raw, high_raw, low_raw, close_raw,
        volume_asset_raw, volume_stable_raw, trade_count,
        first_block, first_transaction_index, first_log_index,
        last_block, last_transaction_index, last_log_index,
        finalized, source)
     VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $6, $7, 1, $8, $9, $10, $8, $9, $10, FALSE, $11)
     ON CONFLICT (chain_id, pool, interval_seconds, bucket_start) DO UPDATE SET
        high_raw = GREATEST(candles.high_raw, EXCLUDED.high_raw),
        low_raw  = LEAST(candles.low_raw, EXCLUDED.low_raw),

        -- Open belongs to the earliest contributing log, close to the latest. Comparing the
        -- ordering tuples makes a replay in any order converge on the same candle.
        open_raw = CASE
          WHEN (EXCLUDED.first_block, EXCLUDED.first_transaction_index, EXCLUDED.first_log_index)
             < (candles.first_block, candles.first_transaction_index, candles.first_log_index)
          THEN EXCLUDED.open_raw ELSE candles.open_raw END,
        first_block = LEAST(candles.first_block, EXCLUDED.first_block),
        first_transaction_index = CASE
          WHEN (EXCLUDED.first_block, EXCLUDED.first_transaction_index, EXCLUDED.first_log_index)
             < (candles.first_block, candles.first_transaction_index, candles.first_log_index)
          THEN EXCLUDED.first_transaction_index ELSE candles.first_transaction_index END,
        first_log_index = CASE
          WHEN (EXCLUDED.first_block, EXCLUDED.first_transaction_index, EXCLUDED.first_log_index)
             < (candles.first_block, candles.first_transaction_index, candles.first_log_index)
          THEN EXCLUDED.first_log_index ELSE candles.first_log_index END,

        close_raw = CASE
          WHEN (EXCLUDED.last_block, EXCLUDED.last_transaction_index, EXCLUDED.last_log_index)
             > (candles.last_block, candles.last_transaction_index, candles.last_log_index)
          THEN EXCLUDED.close_raw ELSE candles.close_raw END,
        last_block = GREATEST(candles.last_block, EXCLUDED.last_block),
        last_transaction_index = CASE
          WHEN (EXCLUDED.last_block, EXCLUDED.last_transaction_index, EXCLUDED.last_log_index)
             > (candles.last_block, candles.last_transaction_index, candles.last_log_index)
          THEN EXCLUDED.last_transaction_index ELSE candles.last_transaction_index END,
        last_log_index = CASE
          WHEN (EXCLUDED.last_block, EXCLUDED.last_transaction_index, EXCLUDED.last_log_index)
             > (candles.last_block, candles.last_transaction_index, candles.last_log_index)
          THEN EXCLUDED.last_log_index ELSE candles.last_log_index END,

        volume_asset_raw = candles.volume_asset_raw + EXCLUDED.volume_asset_raw,
        volume_stable_raw = candles.volume_stable_raw + EXCLUDED.volume_stable_raw,
        trade_count = candles.trade_count + 1,
        updated_at = now()`,
    [
      swap.chainId,
      swap.pool,
      interval,
      start.toString(),
      swap.price.toString(),
      swap.volumeAsset.toString(),
      swap.volumeStable.toString(),
      swap.blockNumber.toString(),
      swap.transactionIndex,
      swap.logIndex,
      source,
    ],
  );
}

/**
 * Mark every bucket that can no longer receive a swap as finalized.
 *
 * "Can no longer receive" means the bucket ended before the newest indexed block's timestamp
 * *and* its blocks are past the confirmation depth. A bucket still open is served with
 * `finalized: false` so a chart can redraw its last bar instead of treating it as settled.
 */
export async function finalizeCandles(
  tx: Queryable,
  chainId: number,
  pool: string,
  safeTimestamp: bigint,
): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE candles SET finalized = TRUE, updated_at = now()
      WHERE chain_id = $1 AND pool = $2 AND finalized = FALSE
        AND bucket_start + interval_seconds <= $3`,
    [chainId, pool, safeTimestamp.toString()],
  );
  return rowCount;
}
