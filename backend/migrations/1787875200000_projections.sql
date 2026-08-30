-- Milestone B — protocol projections.
--
-- Every table is keyed by chain_id and, where an asset owns the row, by asset_id, so one
-- database can hold Anvil, Base Sepolia and Hedera without a query ever crossing series.
-- Every row records the (block_number, transaction_index, log_index) that produced it and
-- cascades from indexed_blocks, so a reorg rollback is a single DELETE on the block range.
--
-- Money columns use the uint256 / int256 domains from the chain-integrity migration: a
-- fractional value is rejected, never rounded.

-- Up Migration

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------

-- The log filter is built from this table, not from configuration. Root addresses are
-- seeded at startup; component addresses arrive with AssetSystemDeployed, so a second asset
-- is indexed without a config change (CONTRACTS_TO_BACKEND section 1).
CREATE TABLE watched_addresses (
    chain_id BIGINT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
    address eth_address NOT NULL,
    kind TEXT NOT NULL,
    asset_id eth_hash,
    -- Where the address was discovered. NULL for the configured roots.
    discovered_at_block BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address, kind)
);

CREATE INDEX watched_addresses_asset_idx ON watched_addresses (chain_id, asset_id);

-- ---------------------------------------------------------------------------
-- Asset identity and lifecycle
-- ---------------------------------------------------------------------------

CREATE TABLE assets (
    chain_id BIGINT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
    asset_id eth_hash NOT NULL,
    issuer eth_address NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT,
    category TEXT NOT NULL,
    metadata_uri TEXT NOT NULL,
    metadata_hash eth_hash NOT NULL,
    maturity_timestamp BIGINT NOT NULL,
    -- 0 Pending, 1 Approved, 2 Active, 3 Suspended, 4 Defaulted, 5 Matured, 6 Closed.
    -- Stored as the integer the contracts use; the API maps it to a name.
    status SMALLINT NOT NULL DEFAULT 0 CHECK (status BETWEEN 0 AND 6),
    current_nav uint256,
    nav_updated_at BIGINT,
    submitted_block BIGINT NOT NULL,
    submitted_at BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, asset_id)
);

CREATE TABLE asset_deployments (
    chain_id BIGINT NOT NULL,
    asset_id eth_hash NOT NULL,
    token eth_address NOT NULL,
    vault eth_address NOT NULL,
    offering eth_address NOT NULL,
    market_manager eth_address NOT NULL,
    revenue_distributor eth_address NOT NULL,
    redemption_controller eth_address NOT NULL,
    -- AssetContractsSet carries no pool; only AssetSystemDeployed does.
    pool eth_address,
    deployed_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, asset_id),
    FOREIGN KEY (chain_id, asset_id) REFERENCES assets (chain_id, asset_id) ON DELETE CASCADE
);

-- One component address may never belong to two series.
CREATE UNIQUE INDEX asset_deployments_token_key ON asset_deployments (chain_id, token);
CREATE UNIQUE INDEX asset_deployments_vault_key ON asset_deployments (chain_id, vault);
CREATE UNIQUE INDEX asset_deployments_offering_key ON asset_deployments (chain_id, offering);

CREATE TABLE asset_status_history (
    chain_id BIGINT NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    previous_status SMALLINT NOT NULL,
    new_status SMALLINT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE TABLE nav_history (
    chain_id BIGINT NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    previous_nav uint256 NOT NULL,
    new_nav uint256 NOT NULL,
    -- The registry's own timestamp argument, not the block timestamp.
    nav_timestamp BIGINT NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX nav_history_asset_idx ON nav_history (chain_id, asset_id, block_number DESC);

-- ---------------------------------------------------------------------------
-- Token supply and holders
-- ---------------------------------------------------------------------------

-- Three distinct denominators, none interchangeable (CHANGED 2026-08-27):
--   total_supply             every minted token
--   investor_supply          total_supply - issuer_allocation_supply   (backing, redemption)
--   yield_eligible_supply    total_supply - excluded_supply            (revenue)
-- Each is maintained incrementally and validated against the contract's own view.
CREATE TABLE token_supply (
    chain_id BIGINT NOT NULL,
    token eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    total_supply uint256 NOT NULL DEFAULT 0,
    excluded_supply uint256 NOT NULL DEFAULT 0,
    issuer_allocation_supply uint256 NOT NULL DEFAULT 0,
    updated_block BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chain_id, token)
);

CREATE TABLE token_balances (
    chain_id BIGINT NOT NULL,
    token eth_address NOT NULL,
    holder eth_address NOT NULL,
    balance uint256 NOT NULL DEFAULT 0,
    -- Flags change a denominator with NO Transfer event, so both are projected from their
    -- own events and both must trigger a supply recompute.
    yield_excluded BOOLEAN NOT NULL DEFAULT FALSE,
    issuer_allocation BOOLEAN NOT NULL DEFAULT FALSE,
    compliance_exempt BOOLEAN NOT NULL DEFAULT FALSE,
    frozen BOOLEAN NOT NULL DEFAULT FALSE,
    frozen_tokens uint256 NOT NULL DEFAULT 0,
    updated_block BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chain_id, token, holder)
);

CREATE INDEX token_balances_holder_idx ON token_balances (chain_id, holder);
CREATE INDEX token_balances_nonzero_idx ON token_balances (chain_id, token) WHERE balance > 0;

CREATE TABLE token_transfers (
    chain_id BIGINT NOT NULL,
    token eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    from_address eth_address NOT NULL,
    to_address eth_address NOT NULL,
    value uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX token_transfers_token_idx ON token_transfers (chain_id, token, block_number DESC);
CREATE INDEX token_transfers_from_idx ON token_transfers (chain_id, from_address, block_number DESC);
CREATE INDEX token_transfers_to_idx ON token_transfers (chain_id, to_address, block_number DESC);

-- ---------------------------------------------------------------------------
-- Vault accounting
-- ---------------------------------------------------------------------------

-- Current balance of each of the five categories. AllocationChanged is the single source;
-- the other vault events are annotations on the same movement.
CREATE TABLE vault_balances (
    chain_id BIGINT NOT NULL,
    vault eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    redemption_reserve uint256 NOT NULL DEFAULT 0,
    market_making_allocation uint256 NOT NULL DEFAULT 0,
    asset_revenue uint256 NOT NULL DEFAULT 0,
    issuer_proceeds uint256 NOT NULL DEFAULT 0,
    protocol_fees uint256 NOT NULL DEFAULT 0,
    total_accounted uint256 NOT NULL DEFAULT 0,
    updated_block BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chain_id, vault)
);

CREATE TABLE vault_allocations (
    chain_id BIGINT NOT NULL,
    vault eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    category TEXT NOT NULL,
    delta int256 NOT NULL,
    new_category_balance uint256 NOT NULL,
    total_accounted uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX vault_allocations_vault_idx ON vault_allocations (chain_id, vault, block_number DESC);

-- D-023. The schedule is configuration, not a running total: target backing rises with time,
-- so a shortfall can begin with no transaction at all. Stored so the API can compute
-- targetBacking(t) at query time instead of trusting a stale event.
CREATE TABLE reserve_schedules (
    chain_id BIGINT NOT NULL,
    vault eth_address NOT NULL,
    start_backing uint256 NOT NULL,
    target_backing uint256 NOT NULL,
    start_time BIGINT NOT NULL,
    maturity BIGINT NOT NULL,
    grace_seconds BIGINT NOT NULL,
    set_at_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, vault)
);

CREATE TABLE reserve_contributions (
    chain_id BIGINT NOT NULL,
    vault eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    issuer eth_address NOT NULL,
    period_id uint256 NOT NULL,
    amount uint256 NOT NULL,
    new_reserve uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE TABLE reserve_shortfall_events (
    chain_id BIGINT NOT NULL,
    vault eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    entered BOOLEAN NOT NULL,
    at_timestamp BIGINT NOT NULL,
    backing uint256 NOT NULL,
    target_backing uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Offering, revenue, redemption
-- ---------------------------------------------------------------------------

CREATE TABLE offering_purchases (
    chain_id BIGINT NOT NULL,
    offering eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    buyer eth_address NOT NULL,
    stablecoin_amount uint256 NOT NULL,
    token_amount uint256 NOT NULL,
    -- Stored as emitted. Never recomputed from a bps constant: the splits are becoming
    -- admin-settable (D-023), and a recomputed share would silently diverge.
    issuer_share uint256 NOT NULL,
    reserve_share uint256 NOT NULL,
    market_share uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX offering_purchases_buyer_idx ON offering_purchases (chain_id, buyer, block_number DESC);
CREATE INDEX offering_purchases_asset_idx ON offering_purchases (chain_id, asset_id, block_number DESC);

CREATE TABLE revenue_deposits (
    chain_id BIGINT NOT NULL,
    distributor eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    depositor eth_address NOT NULL,
    -- D-022 period tagging; D-023 behind-schedule split variant.
    period_id uint256,
    report_hash eth_hash,
    behind_schedule BOOLEAN,
    gross_amount uint256 NOT NULL,
    holder_amount uint256 NOT NULL,
    reserve_amount uint256 NOT NULL,
    operator_amount uint256 NOT NULL,
    protocol_amount uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE TABLE revenue_claims (
    chain_id BIGINT NOT NULL,
    distributor eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    claimant eth_address NOT NULL,
    -- 'holder' or 'operator'; the two have separate accruals in the distributor.
    claim_kind TEXT NOT NULL CHECK (claim_kind IN ('holder', 'operator')),
    amount uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX revenue_claims_claimant_idx ON revenue_claims (chain_id, claimant, block_number DESC);

CREATE TABLE redemptions (
    chain_id BIGINT NOT NULL,
    controller eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    holder eth_address NOT NULL,
    -- 0 Normal, 1 Maturity, 2 Emergency.
    mode SMALLINT NOT NULL CHECK (mode BETWEEN 0 AND 2),
    token_amount uint256 NOT NULL,
    stablecoin_amount uint256 NOT NULL,
    nav uint256 NOT NULL,
    redemption_price uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX redemptions_holder_idx ON redemptions (chain_id, holder, block_number DESC);

-- ---------------------------------------------------------------------------
-- Market manager
-- ---------------------------------------------------------------------------

CREATE TABLE position_configs (
    chain_id BIGINT NOT NULL,
    market_manager eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    -- 0 ReserveFloor, 1 Anchor, 2 Discovery, 3 Intermediary.
    kind SMALLINT NOT NULL CHECK (kind BETWEEN 0 AND 3),
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    -- Raw uint128. Never converted to token amounts: that needs a real curve, not a cast.
    liquidity uint256 NOT NULL DEFAULT 0,
    configured BOOLEAN NOT NULL DEFAULT TRUE,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, market_manager, kind)
);

CREATE TABLE position_liquidity_events (
    chain_id BIGINT NOT NULL,
    market_manager eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    kind SMALLINT NOT NULL CHECK (kind BETWEEN 0 AND 3),
    action TEXT NOT NULL CHECK (action IN ('Configured', 'LiquidityAdded', 'LiquidityRemoved', 'FeesCollected')),
    liquidity uint256,
    -- token0/token1 order as emitted; assetIsToken0() decides the label at the API edge.
    amount0 uint256,
    amount1 uint256,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE TABLE market_rebalances (
    chain_id BIGINT NOT NULL,
    market_manager eth_address NOT NULL,
    asset_id eth_hash NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    operation TEXT NOT NULL,
    spot_price uint256 NOT NULL,
    twap_price uint256 NOT NULL,
    nav uint256 NOT NULL,
    anchor_lower INTEGER NOT NULL,
    anchor_upper INTEGER NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

-- Audit only. These are the manager's own swaps and carry no post-swap tick, so they can
-- never be aggregated into OHLC on their own (BACKEND_INDEXER section 7).
CREATE TABLE manager_swaps (
    chain_id BIGINT NOT NULL,
    market_manager eth_address NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    zero_for_one BOOLEAN NOT NULL,
    amount_in uint256 NOT NULL,
    amount_out uint256 NOT NULL,
    sqrt_price_limit_x96 uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Compliance
-- ---------------------------------------------------------------------------

-- isVerified is deliberately absent: it is a function of now(), computed at query time from
-- claim_expires_at. Storing it would make the API correct at index time and wrong later.
CREATE TABLE identities (
    chain_id BIGINT NOT NULL,
    registry eth_address NOT NULL,
    investor eth_address NOT NULL,
    identity eth_address,
    country INTEGER,
    investor_class SMALLINT,
    claim_expires_at BIGINT,
    registered BOOLEAN NOT NULL DEFAULT FALSE,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, registry, investor)
);

CREATE TABLE compliance_config (
    chain_id BIGINT NOT NULL,
    compliance eth_address NOT NULL,
    token eth_address,
    modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_countries JSONB NOT NULL DEFAULT '[]'::jsonb,
    hold_period_seconds BIGINT,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, compliance)
);

CREATE TABLE holder_locks (
    chain_id BIGINT NOT NULL,
    compliance eth_address NOT NULL,
    holder eth_address NOT NULL,
    locked_until BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    PRIMARY KEY (chain_id, compliance, holder)
);

-- Down Migration

DROP TABLE IF EXISTS holder_locks;
DROP TABLE IF EXISTS compliance_config;
DROP TABLE IF EXISTS identities;
DROP TABLE IF EXISTS manager_swaps;
DROP TABLE IF EXISTS market_rebalances;
DROP TABLE IF EXISTS position_liquidity_events;
DROP TABLE IF EXISTS position_configs;
DROP TABLE IF EXISTS redemptions;
DROP TABLE IF EXISTS revenue_claims;
DROP TABLE IF EXISTS revenue_deposits;
DROP TABLE IF EXISTS offering_purchases;
DROP TABLE IF EXISTS reserve_shortfall_events;
DROP TABLE IF EXISTS reserve_contributions;
DROP TABLE IF EXISTS reserve_schedules;
DROP TABLE IF EXISTS vault_allocations;
DROP TABLE IF EXISTS vault_balances;
DROP TABLE IF EXISTS token_transfers;
DROP TABLE IF EXISTS token_balances;
DROP TABLE IF EXISTS token_supply;
DROP TABLE IF EXISTS asset_status_history;
DROP TABLE IF EXISTS nav_history;
DROP TABLE IF EXISTS asset_deployments;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS watched_addresses;
