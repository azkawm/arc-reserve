import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database, Queryable } from '../db/client.js';
import { loadWatchedSet, seedRootAddresses, type WatchedSet } from './watched.js';
import { decodeLog } from './decode.js';
import { projectDecodedLog, type StoredLogRow } from './ingest.js';

/**
 * Rebuilding the read model from the stored logs.
 *
 * Why this exists: the projection tables come in two shapes. History tables
 * (`token_transfers`, `vault_allocations`, ...) are keyed by block and cascade away when an
 * orphaned block is deleted. Current-state tables (`token_supply`, `vault_balances`,
 * `token_balances`, `position_configs`, `identities`, ...) are *incrementally maintained
 * aggregates* with no block key at all — a balance is the sum of everything that ever
 * happened to it. Deleting the reorged blocks does nothing to them, so after a rollback they
 * would still carry the effects of logs that no longer exist.
 *
 * Rather than write a bespoke inverse for every projector — six kinds of arithmetic to get
 * exactly right, in reverse — the read model is rebuilt as a pure function of the canonical
 * log sequence: clear the projections, replay the surviving `raw_logs` in chain order. The
 * raw logs above the common ancestor are already gone (they cascade with their blocks), so
 * what remains *is* the canonical history.
 *
 * The cost is a full re-projection per reorg. On a demo chain that is milliseconds. On a long
 * chain the optimisation is periodic snapshots of the current-state tables, rebuilding from
 * the most recent snapshot below the ancestor rather than from genesis.
 */

/** Every table derived from logs. Order matters only for readability; one TRUNCATE-equivalent
 *  DELETE per table inside a single transaction. */
const PROJECTION_TABLES = [
  // History (would cascade anyway, but a rebuild must start from nothing).
  'token_transfers',
  'vault_allocations',
  'nav_history',
  'asset_status_history',
  'offering_purchases',
  'revenue_deposits',
  'revenue_claims',
  'redemptions',
  'position_liquidity_events',
  'market_rebalances',
  'manager_swaps',
  'reserve_contributions',
  'reserve_shortfall_events',
  'pool_swaps',
  'floor_level_ups',
  // Candles have no block key at all — a bucket spans blocks — so they are rebuilt, never
  // cascaded away.
  'candles',
  // Current-state aggregates: the reason this module exists.
  'token_balances',
  'token_supply',
  'vault_balances',
  'position_configs',
  'identities',
  'compliance_config',
  'holder_locks',
  'reserve_schedules',
  'asset_deployments',
  'assets',
  'watched_addresses',
] as const;

export interface RebuildResult {
  logsReplayed: number;
  logsProjected: number;
  logsUnknown: number;
}

export async function clearProjections(tx: Queryable, chainId: number): Promise<void> {
  for (const table of PROJECTION_TABLES) {
    // Table names come from the const tuple above, never from input.
    await tx.query(`DELETE FROM ${table} WHERE chain_id = $1`, [chainId]);
  }
}

/**
 * Clear and re-derive every projection for one chain from its stored logs.
 * Runs in a single transaction: either the read model is fully rebuilt or it is untouched.
 */
export async function rebuildProjections(
  db: Database,
  config: Config,
  logger?: Logger,
): Promise<RebuildResult> {
  const result: RebuildResult = { logsReplayed: 0, logsProjected: 0, logsUnknown: 0 };

  await db.withTransaction(async (tx) => {
    await clearProjections(tx, config.CHAIN_ID);
    await seedRootAddresses(tx, config);

    const watched: WatchedSet = await loadWatchedSet(tx, config.CHAIN_ID);

    const { rows } = await tx.query<StoredLogRow>(
      `SELECT rl.transaction_hash, rl.log_index, rl.block_number, rl.transaction_index,
              rl.address, rl.topic0, rl.topic1, rl.topic2, rl.topic3, rl.data,
              ib.timestamp AS block_timestamp
         FROM raw_logs rl
         JOIN indexed_blocks ib ON ib.chain_id = rl.chain_id AND ib.number = rl.block_number
        WHERE rl.chain_id = $1
        ORDER BY rl.block_number, rl.transaction_index, rl.log_index`,
      [config.CHAIN_ID],
    );

    for (const row of rows) {
      result.logsReplayed += 1;
      const entry = watched.get(row.address);
      // An address that is no longer discovered in this replay: its logs were captured under
      // a discovery that the rollback undid. Skipped, not guessed at.
      if (entry === undefined) continue;

      const topics = [row.topic0, row.topic1, row.topic2, row.topic3].filter(
        (topic): topic is `0x${string}` => topic !== null,
      );
      const decoded = decodeLog(entry.kind, { topics, data: row.data as `0x${string}` });

      if (decoded.eventName === null || decoded.args === null) {
        result.logsUnknown += 1;
        continue;
      }

      const projected = await projectDecodedLog(tx, config.CHAIN_ID, watched, entry, row, decoded, logger);
      if (projected) result.logsProjected += 1;
    }
  });

  logger?.info({ ...result }, 'rebuilt projections from stored logs');
  return result;
}
