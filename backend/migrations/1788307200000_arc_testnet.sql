-- D-027 amendment (owner, 2026-09-13): Circle Arc testnet, chain 5042002, is in scope.
--
-- chains_testnet_only is the database half of the testnet-only rule — config refuses a mainnet id,
-- and this refuses to store one even if config were bypassed. It must be widened explicitly for Arc:
-- without this migration the Arc indexer passes its own config validation and then fails on the very
-- first insert, when it registers its chain. The rule itself does not loosen. Every id added is a
-- testnet, and Arc mainnet stays refused.

-- Up Migration

ALTER TABLE chains DROP CONSTRAINT chains_testnet_only;
ALTER TABLE chains
    ADD CONSTRAINT chains_testnet_only CHECK (chain_id IN (31337, 84532, 296, 5042002));

-- Down Migration

-- Fails, deliberately, while any chain-5042002 row exists: narrowing the rule would otherwise orphan
-- an indexed chain's data. Remove that chain's rows first if this is really wanted.
ALTER TABLE chains DROP CONSTRAINT chains_testnet_only;
ALTER TABLE chains
    ADD CONSTRAINT chains_testnet_only CHECK (chain_id IN (31337, 84532, 296));
