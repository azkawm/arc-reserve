-- A durable record of every rollback the indexer performs.
--
-- On 2026-09-12 the indexer twice rolled back "reorgs" on Hedera, a chain with no reorgs, and each
-- time rebuilt every projection. Nothing recorded it. The cursor row carries a reorg_depth, but
-- rollbackTo DELETES the cursor when it rolls back past everything it holds — so the counter was
-- destroyed by the very event it existed to count, and the only trace left was a WARN line in the
-- log of a process that no longer exists. A day passed before anyone noticed the damage.
--
-- So rollbacks get their own table, placed where neither of the two mechanisms that erase history
-- can reach it:
--   - no foreign key to indexed_blocks, so the rollback's own DELETE does not cascade into it;
--   - not in rebuild.ts PROJECTION_TABLES, so a rebuild does not clear it.
-- It is written inside the same transaction as the rollback, so a rollback and its record commit
-- or fail together.

-- Up Migration

CREATE TABLE indexer_rollbacks (
    id BIGSERIAL PRIMARY KEY,
    chain_id BIGINT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
    worker TEXT NOT NULL,
    -- The cursor block that failed its check.
    from_block BIGINT NOT NULL CHECK (from_block >= 0),
    -- Highest block that still matched the chain; everything above it was discarded.
    ancestor_block BIGINT NOT NULL CHECK (ancestor_block >= 0),
    blocks_discarded INTEGER NOT NULL CHECK (blocks_discarded > 0),
    logs_discarded INTEGER NOT NULL CHECK (logs_discarded >= 0),
    -- True when the rollback went past every stored block and the cursor itself was dropped, so the
    -- next pass backfilled from START_BLOCK. That is the expensive case, and the one that left no
    -- trace before this table existed.
    cursor_deleted BOOLEAN NOT NULL,
    rolled_back_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX indexer_rollbacks_recent_idx ON indexer_rollbacks (chain_id, rolled_back_at DESC);

-- Down Migration

DROP TABLE indexer_rollbacks;
