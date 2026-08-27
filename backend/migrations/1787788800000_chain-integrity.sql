-- Milestone A — chain integrity layer.
-- Every table is keyed by chain_id: one database serves Anvil, Base Sepolia and Hedera
-- testnet simultaneously (D-030). No financial value is stored as a float anywhere; the
-- uint256 domain below is the storage-level guarantee behind that rule.

-- Up Migration

-- Lowercase hex is the lookup form everywhere in this service; checksummed hex is produced
-- only at the API edge. The CHECKs make a mixed-case or malformed address a write error
-- rather than a silent cache miss later.
CREATE DOMAIN eth_address AS TEXT CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN eth_hash AS TEXT CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN eth_topic AS TEXT CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN eth_hexdata AS TEXT CHECK (VALUE ~ '^0x([0-9a-f]{2})*$');

-- uint256 base units.
--
-- Deliberately unconstrained NUMERIC, not NUMERIC(78,0): a typmod is applied BEFORE the
-- domain CHECK, so NUMERIC(78,0) would quietly round 1.5 to 2 and pass a scale-0 test. With
-- no typmod the value keeps its scale and SCALE(VALUE) = 0 rejects it. That is the whole
-- point of the domain — a fractional amount must be an error, never a rounded one.
CREATE DOMAIN uint256 AS NUMERIC CHECK (
    SCALE(VALUE) = 0
    AND VALUE >= 0
    AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
);

CREATE DOMAIN int256 AS NUMERIC CHECK (
    SCALE(VALUE) = 0
    AND VALUE >= -57896044618658097711785492504343953926634992332820282019728792003956564819968
    AND VALUE <= 57896044618658097711785492504343953926634992332820282019728792003956564819967
);

CREATE TABLE chains (
    chain_id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    finality_confirmations INTEGER NOT NULL DEFAULT 0 CHECK (finality_confirmations >= 0),
    -- Configuration fingerprint. A process pointed at a different deployment on the same
    -- chain id (a fresh Anvil, a redeployed testnet) must be refused, not silently indexed.
    registry_address eth_address NOT NULL,
    factory_address eth_address NOT NULL,
    stablecoin_address eth_address NOT NULL,
    start_block BIGINT NOT NULL DEFAULT 0 CHECK (start_block >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chains_testnet_only CHECK (chain_id IN (31337, 84532, 296))
);

COMMENT ON CONSTRAINT chains_testnet_only ON chains IS
    'D-027: hackathon scope is testnet only. Adding a mainnet chain id is a product decision.';

CREATE TABLE indexed_blocks (
    chain_id BIGINT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
    number BIGINT NOT NULL CHECK (number >= 0),
    hash eth_hash NOT NULL,
    parent_hash eth_hash NOT NULL,
    timestamp BIGINT NOT NULL CHECK (timestamp >= 0),
    canonical BOOLEAN NOT NULL DEFAULT TRUE,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, number)
);

-- A hash may appear once per chain. Re-observing the same block is idempotent; observing a
-- different hash at the same height is a reorg, handled by rollback, never by overwrite.
CREATE UNIQUE INDEX indexed_blocks_chain_hash_key ON indexed_blocks (chain_id, hash);
CREATE INDEX indexed_blocks_timestamp_idx ON indexed_blocks (chain_id, timestamp);

CREATE TABLE raw_logs (
    chain_id BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    block_number BIGINT NOT NULL,
    block_hash eth_hash NOT NULL,
    transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
    address eth_address NOT NULL,
    topic0 eth_topic,
    topic1 eth_topic,
    topic2 eth_topic,
    topic3 eth_topic,
    data eth_hexdata NOT NULL,
    -- NULL until a decoder recognises topic0. An unknown log is retained for diagnosis and
    -- never projected as trusted state (BACKEND_INDEXER.md s16).
    event_name TEXT,
    contract_name TEXT,
    -- Diagnostics only. Projections read the decoded values from the decoder, not from here.
    decoded JSONB,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    -- Rolling back a reorged block deletes its logs in the same statement.
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

-- The canonical replay order: block number, then transaction index, then log index.
CREATE INDEX raw_logs_order_idx ON raw_logs (chain_id, block_number, transaction_index, log_index);
CREATE INDEX raw_logs_address_topic_idx ON raw_logs (chain_id, address, topic0, block_number);
CREATE INDEX raw_logs_unknown_idx ON raw_logs (chain_id, block_number) WHERE event_name IS NULL;

CREATE TABLE indexer_cursors (
    chain_id BIGINT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
    -- 'arc-events', 'pool-swaps', 'candles'
    worker TEXT NOT NULL,
    block_number BIGINT NOT NULL CHECK (block_number >= 0),
    -- Checkpointed so a restart against a different chain history is detected, not indexed.
    block_hash eth_hash NOT NULL,
    block_timestamp BIGINT NOT NULL CHECK (block_timestamp >= 0),
    reorg_depth INTEGER NOT NULL DEFAULT 0 CHECK (reorg_depth >= 0),
    last_error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, worker)
);

-- "Flag the row, never overwrite silently." An emitted balance that disagrees with the
-- applied delta, an undecodable known topic, or a view read that contradicts a projection
-- lands here and surfaces in /v1/health. It is evidence, not state.
CREATE TABLE projection_anomalies (
    id BIGSERIAL PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    block_number BIGINT,
    transaction_hash eth_hash,
    log_index INTEGER,
    worker TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail JSONB NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projection_anomalies_open_idx ON projection_anomalies (chain_id, created_at DESC)
    WHERE resolved = FALSE;

-- Down Migration

DROP TABLE IF EXISTS projection_anomalies;
DROP TABLE IF EXISTS indexer_cursors;
DROP TABLE IF EXISTS raw_logs;
DROP TABLE IF EXISTS indexed_blocks;
DROP TABLE IF EXISTS chains;
DROP DOMAIN IF EXISTS int256;
DROP DOMAIN IF EXISTS uint256;
DROP DOMAIN IF EXISTS eth_hexdata;
DROP DOMAIN IF EXISTS eth_topic;
DROP DOMAIN IF EXISTS eth_hash;
DROP DOMAIN IF EXISTS eth_address;
