-- D-025 published floor level, and D-026 term-sheet binding.
--
-- The floor's *current* level is deliberately not stored. `floorTick` / `floorPrice()` are live
-- reads, and `isFloorCovered()` can flip to false with **no event and no state change** — a NAV
-- markdown can leave a previously valid level above the new NAV, and D-025 pauses the ratchet
-- rather than lowering the floor. A projected "covered" flag would therefore be correct only
-- until the next markdown, which is the same class of lie as a cached staleness boolean.
-- What is stored here is the ratchet's history, which is genuinely event-sourced.

-- Up Migration

ALTER TABLE assets ADD COLUMN terms_hash eth_hash;

COMMENT ON COLUMN assets.terms_hash IS
    'D-026: keccak256 of the approved DeploymentParams. Frozen at approval, so for an Active '
    'asset it describes the parameters actually deployed.';

ALTER TABLE asset_deployments ADD COLUMN floor_controller eth_address;

CREATE TABLE floor_level_ups (
    chain_id BIGINT NOT NULL,
    controller eth_address NOT NULL,
    asset_id eth_hash,
    block_number BIGINT NOT NULL,
    transaction_hash eth_hash NOT NULL,
    log_index INTEGER NOT NULL,
    previous_tick INTEGER NOT NULL,
    new_tick INTEGER NOT NULL,
    -- 6-decimal mUSD per whole token, directly comparable with NAV and spot.
    floor_price uint256 NOT NULL,
    backing uint256 NOT NULL,
    nav uint256 NOT NULL,
    block_timestamp BIGINT NOT NULL,
    PRIMARY KEY (chain_id, transaction_hash, log_index),
    FOREIGN KEY (chain_id, block_number) REFERENCES indexed_blocks (chain_id, number) ON DELETE CASCADE
);

CREATE INDEX floor_level_ups_controller_idx
    ON floor_level_ups (chain_id, controller, block_number DESC);

-- Down Migration

DROP TABLE IF EXISTS floor_level_ups;
ALTER TABLE asset_deployments DROP COLUMN IF EXISTS floor_controller;
ALTER TABLE assets DROP COLUMN IF EXISTS terms_hash;
