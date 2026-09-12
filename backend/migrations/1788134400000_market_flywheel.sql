-- D-035/D-037: the market flywheel, and the swap that reports what it actually spent.
--
-- `SwapExactInput` carries BOTH `amountRequested` and `amountSpent`, and they diverge on a
-- partial fill — one measured trade requested 60,000 and spent 630.32, a 95x gap. Trade size is
-- `amountSpent`; `amountRequested` is kept beside it because a request that could not be filled
-- is itself worth seeing, and because a column that silently held the wrong one of the two would
-- overstate every volume figure on the chart without ever looking broken.
--
-- It is a separate table from `manager_swaps` rather than nullable columns bolted onto it: the
-- two events describe different things. `SwapExecuted` is a keeper's bounded swap (direction and
-- a price limit, no trader); `SwapExactInput` is a caller spending an exact input (a trader and a
-- token, no limit). Forcing them into one row would make every column optional and the meaning
-- of each row depend on which of them was null.

-- Up Migration

CREATE TABLE manager_exact_input_swaps (
    chain_id BIGINT NOT NULL,
    market_manager eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    trader eth_address NOT NULL,
    token_in eth_address NOT NULL,
    -- What the caller asked to spend. Never the trade size.
    amount_requested uint256 NOT NULL,
    -- What the pool actually took. This is the trade size.
    amount_spent uint256 NOT NULL,
    amount_out uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX manager_exact_input_swaps_trader_idx
    ON manager_exact_input_swaps (chain_id, trader, block_number DESC);

COMMENT ON COLUMN manager_exact_input_swaps.amount_requested IS
    'D-037: the requested input, which a partial fill leaves unspent. Never use it as volume.';

COMMENT ON COLUMN manager_exact_input_swaps.amount_spent IS
    'D-037: the input actually spent. This is the trade size for volume and average price.';

-- Down Migration

DROP TABLE manager_exact_input_swaps;
