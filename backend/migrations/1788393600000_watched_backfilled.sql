-- Whether a discovered component's logs from BEFORE the range that discovered it have been fetched.
--
-- A component emits before the event that announces it, so when a range discovers one, its earlier
-- logs are backfilled from its creation block. That backfill used to be triggered by "discovered in
-- this pass", which a failed attempt consumed: the attempt persisted the discovery, the backfill
-- threw, and on retry nothing was new, so no backfill ran and the range completed without those logs.
-- A crash mid-backfill did the same. Found by replaying Arc's real deployment behind a relay whose
-- deep history fails: the range converged, twelve logs short.
--
-- So the obligation is recorded, not inferred. A component discovered by a log starts FALSE and is
-- marked TRUE only once its backfill has completed; pending work is always read from this column.
--
-- Existing rows default to TRUE. Roots are fetched from START_BLOCK by the normal loop and owe
-- nothing. Discovered rows on 296 and 5042002 were checked by receipt diff (0 missing) before this
-- migration, and that diff is re-run after it applies, because TRUE is only as honest as that check.

-- Up Migration

ALTER TABLE watched_addresses ADD COLUMN backfilled BOOLEAN NOT NULL DEFAULT TRUE;

-- TRUE was only for the rows that exist now. From here on, an insert that does not name the column
-- (a pre-migration process still running, a fixture, a manual repair) must read as OWING a backfill:
-- FALSE costs one redundant backfill, TRUE silently marks unfetched logs as fetched. (arcreserve-6b)
ALTER TABLE watched_addresses ALTER COLUMN backfilled SET DEFAULT FALSE;

CREATE INDEX watched_addresses_backfill_pending_idx
    ON watched_addresses (chain_id)
    WHERE NOT backfilled;

-- Down Migration

DROP INDEX watched_addresses_backfill_pending_idx;
ALTER TABLE watched_addresses DROP COLUMN backfilled;
