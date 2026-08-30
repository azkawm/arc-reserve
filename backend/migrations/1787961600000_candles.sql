-- Milestone D — pool swaps and OHLC candles.
--
-- Two sources, never mixed in one series: `canonical_swap` candles are aggregated from a real
-- Uniswap V3 `Swap` log, and `mock` candles come from the synthetic demo adapter. The source
-- is stored on every row and published on every response, because a candle whose price never
-- moved with a trade is a drawing, not market history (D-019).

-- Up Migration

CREATE TABLE pool_swaps (
    chain_id BIGINT NOT NULL,
    pool eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    transaction_index INTEGER NOT NULL,
    sender eth_address NOT NULL,
    recipient eth_address NOT NULL,
    -- Signed pool deltas exactly as emitted: negative is out of the pool.
    amount0 int256 NOT NULL,
    amount1 int256 NOT NULL,
    sqrt_price_x96 uint256 NOT NULL,
    liquidity uint256 NOT NULL,
    tick INTEGER NOT NULL,
    -- Stablecoin per whole asset token at 6 decimals, derived from sqrt_price_x96 and the
    -- pool's token ordering. Stored so a candle rebuild never re-derives it differently.
    price uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX pool_swaps_order_idx ON pool_swaps (chain_id, pool, block_number, transaction_index, log_index);
CREATE INDEX pool_swaps_time_idx ON pool_swaps (chain_id, pool, block_timestamp);

CREATE TABLE candles (
    chain_id BIGINT NOT NULL,
    pool eth_address NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
    bucket_start BIGINT NOT NULL CHECK (bucket_start >= 0),

    open_raw uint256 NOT NULL,
    high_raw uint256 NOT NULL,
    low_raw uint256 NOT NULL,
    close_raw uint256 NOT NULL,

    volume_asset_raw uint256 NOT NULL DEFAULT 0,
    volume_stable_raw uint256 NOT NULL DEFAULT 0,
    trade_count INTEGER NOT NULL DEFAULT 0 CHECK (trade_count >= 0),

    -- First and last contributing log, in chain order. Keeping both makes open/close
    -- reproducible without re-reading the swaps.
    first_block BIGINT NOT NULL,
    first_transaction_index INTEGER NOT NULL,
    first_log_index INTEGER NOT NULL,
    last_block BIGINT NOT NULL,
    last_transaction_index INTEGER NOT NULL,
    last_log_index INTEGER NOT NULL,

    -- False while the bucket can still receive a swap, or while its blocks are unfinalised.
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL CHECK (source IN ('canonical_swap', 'mock')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (chain_id, pool, interval_seconds, bucket_start),
    CONSTRAINT candles_ohlc_ordered CHECK (high_raw >= low_raw AND high_raw >= open_raw
        AND high_raw >= close_raw AND low_raw <= open_raw AND low_raw <= close_raw)
);

COMMENT ON CONSTRAINT candles_ohlc_ordered ON candles IS
    'A candle whose high is below its close is a bug, not a market condition.';

CREATE INDEX candles_query_idx ON candles (chain_id, pool, interval_seconds, bucket_start DESC);

-- Down Migration

DROP TABLE IF EXISTS candles;
DROP TABLE IF EXISTS pool_swaps;
