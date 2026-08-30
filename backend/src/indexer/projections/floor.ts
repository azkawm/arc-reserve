import { persistWatched } from '../watched.js';
import { big, num, type Projector } from './types.js';

/**
 * D-025 — the published protected floor.
 *
 * Only the ratchet's *history* is projected. The current level is a live read, because
 * `isFloorCovered()` can go false with no event and no state change at all: a NAV markdown can
 * leave a valid level sitting above the new NAV, and D-025 pauses the ratchet rather than
 * lowering the floor. Deriving coverage from `FloorLevelUp` history would produce a flag that
 * is correct only until the next markdown.
 */

const floorLevelUp: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO floor_level_ups (chain_id, controller, asset_id, block_number, transaction_hash,
                                  log_index, previous_tick, new_tick, floor_price, backing, nav,
                                  block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      num(args, 'previousTick'),
      num(args, 'newTick'),
      big(args, 'floorPrice').toString(),
      big(args, 'backing').toString(),
      big(args, 'nav').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

/** Cooldown is configuration; the current value is read live with the rest of the floor state. */
const floorLevelCooldownSet: Projector = async () => {
  // Archived in raw_logs for the activity feed; no aggregate to update.
};

export const floorProjectors: Record<string, Projector> = {
  FloorLevelUp: floorLevelUp,
  FloorLevelCooldownSet: floorLevelCooldownSet,
};

/**
 * `AssetMarketManager.FloorControllerSet` is the discovery hook — the controller is not part of
 * `AssetSystemDeployed`, so without this its events would never be seen at all.
 */
export const floorControllerSet: Projector = async (ctx, args, { tx, watched }) => {
  const controller = String(args.controller ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(controller)) return;
  if (controller === '0x0000000000000000000000000000000000000000') return;

  const entry = {
    address: controller as `0x${string}`,
    kind: 'floorController' as const,
    assetId: ctx.assetId,
  };
  watched.add(entry);
  await persistWatched(tx, ctx.chainId, entry, ctx.blockNumber);

  if (ctx.assetId !== null) {
    await tx.query(
      `UPDATE asset_deployments SET floor_controller = $3
        WHERE chain_id = $1 AND asset_id = $2`,
      [ctx.chainId, ctx.assetId, controller],
    );
  }
};
