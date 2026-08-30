import { addr, big, bytes32ToString, hex32, type Projector } from './types.js';

/**
 * AssetVault: the five-category ledger and the D-023 reserve schedule.
 *
 * `AllocationChanged` is the single source for all five buckets; the other vault events
 * (InitialReserveDeposited, RedemptionReleased, ...) are annotations on the same movement
 * and are kept in `raw_logs` for the activity feed rather than double-counted here.
 */

/**
 * Category literal to column. This map is also the allowlist that makes the interpolated
 * `${column}` below safe: an unrecognised category never reaches SQL, it becomes an anomaly.
 */
const CATEGORY_COLUMN: Record<string, string> = {
  REDEMPTION_RESERVE: 'redemption_reserve',
  MARKET_ALLOCATION: 'market_making_allocation',
  ASSET_REVENUE: 'asset_revenue',
  ISSUER_PROCEEDS: 'issuer_proceeds',
  PROTOCOL_FEES: 'protocol_fees',
};

const allocationChanged: Projector = async (ctx, args, deps) => {
  const { tx } = deps;
  const category = bytes32ToString(hex32(args, 'category'));
  const delta = big(args, 'delta');
  const emittedBalance = big(args, 'newCategoryBalance');
  const totalAccounted = big(args, 'totalAccounted');

  const column = CATEGORY_COLUMN[category];
  if (column === undefined) {
    // A category the contracts added without announcing it. Recorded, never guessed at.
    await deps.flagAnomaly(ctx, 'unknown_vault_category', { category, delta: delta.toString() });
    return;
  }

  await tx.query(
    `INSERT INTO vault_allocations (chain_id, vault, block_number, transaction_hash, log_index,
                                    category, delta, new_category_balance, total_accounted,
                                    block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      category,
      delta.toString(),
      emittedBalance.toString(),
      totalAccounted.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );

  // Apply the delta to our own running balance and check it against what the contract said.
  // The projection rule from CONTRACTS_TO_BACKEND section 2: on mismatch flag the row, never
  // overwrite silently. The chain is still the authority, so the emitted value is adopted —
  // but the disagreement is recorded and surfaces as `degraded` in /v1/health.
  const { rows } = await tx.query<{ current: string }>(
    `SELECT ${column}::text AS current FROM vault_balances WHERE chain_id = $1 AND vault = $2`,
    [ctx.chainId, ctx.address],
  );

  const current = rows[0] === undefined ? null : BigInt(rows[0].current);
  if (current !== null && current + delta !== emittedBalance) {
    await deps.flagAnomaly(ctx, 'allocation_balance_mismatch', {
      category,
      previous: current.toString(),
      delta: delta.toString(),
      applied: (current + delta).toString(),
      emitted: emittedBalance.toString(),
    });
  }

  await tx.query(
    `INSERT INTO vault_balances (chain_id, vault, asset_id, ${column}, total_accounted, updated_block)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chain_id, vault)
     DO UPDATE SET ${column} = EXCLUDED.${column},
                   total_accounted = EXCLUDED.total_accounted,
                   updated_block = EXCLUDED.updated_block`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      emittedBalance.toString(),
      totalAccounted.toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

/**
 * D-023. Stored as configuration, not as a running total: target backing rises with time, so
 * the API recomputes `targetBacking(t)` at query time. A shortfall can begin with no
 * transaction at all, which is why the schedule matters more than the shortfall events.
 */
const reserveScheduleSet: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO reserve_schedules (chain_id, vault, start_backing, target_backing, start_time,
                                    maturity, grace_seconds, set_at_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (chain_id, vault)
     DO UPDATE SET start_backing = EXCLUDED.start_backing,
                   target_backing = EXCLUDED.target_backing,
                   start_time = EXCLUDED.start_time,
                   maturity = EXCLUDED.maturity,
                   grace_seconds = EXCLUDED.grace_seconds,
                   set_at_block = EXCLUDED.set_at_block`,
    [
      ctx.chainId,
      ctx.address,
      big(args, 'startBacking').toString(),
      big(args, 'targetBacking').toString(),
      big(args, 'startTime').toString(),
      big(args, 'maturity').toString(),
      big(args, 'graceSeconds').toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

const reserveContribution: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO reserve_contributions (chain_id, vault, block_number, transaction_hash,
                                        log_index, issuer, period_id, amount, new_reserve,
                                        block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      addr(args, 'issuer'),
      big(args, 'periodId').toString(),
      big(args, 'amount').toString(),
      big(args, 'newReserve').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

function shortfall(entered: boolean): Projector {
  return async (ctx, args, { tx }) => {
    await tx.query(
      `INSERT INTO reserve_shortfall_events (chain_id, vault, block_number, transaction_hash,
                                             log_index, entered, at_timestamp, backing,
                                             target_backing, block_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        ctx.chainId,
        ctx.address,
        ctx.blockNumber.toString(),
        ctx.transactionHash,
        ctx.logIndex,
        entered,
        big(args, entered ? 'since' : 'clearedAt').toString(),
        big(args, 'backing').toString(),
        big(args, 'targetBacking').toString(),
        ctx.blockTimestamp.toString(),
      ],
    );
  };
}

export const vaultProjectors: Record<string, Projector> = {
  AllocationChanged: allocationChanged,
  ReserveScheduleSet: reserveScheduleSet,
  ReserveContribution: reserveContribution,
  ReserveShortfallEntered: shortfall(true),
  ReserveShortfallCleared: shortfall(false),
};
