import { persistWatched, type WatchedAddress } from '../watched.js';
import {
  addr,
  big,
  hex32,
  num,
  str,
  struct,
  type LogContext,
  type ProjectionDeps,
  type Projector,
} from './types.js';

/**
 * AssetRegistry and AssetFactory: asset identity, lifecycle, NAV, and the discovery of every
 * per-asset component address.
 */

const assetSubmitted: Projector = async (ctx, args, { tx }) => {
  const assetId = hex32(args, 'assetId');
  await tx.query(
    `INSERT INTO assets (chain_id, asset_id, issuer, name, category, metadata_uri, metadata_hash,
                         maturity_timestamp, status, submitted_block, submitted_at, updated_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $9)
     ON CONFLICT (chain_id, asset_id) DO NOTHING`,
    [
      ctx.chainId,
      assetId,
      addr(args, 'issuer'),
      str(args, 'name'),
      str(args, 'category'),
      str(args, 'metadataURI'),
      hex32(args, 'metadataHash'),
      big(args, 'maturityTimestamp').toString(),
      ctx.blockNumber.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

const assetStatusChanged: Projector = async (ctx, args, { tx }) => {
  const assetId = hex32(args, 'assetId');
  const newStatus = num(args, 'newStatus');

  await tx.query(
    `INSERT INTO asset_status_history (chain_id, asset_id, block_number, transaction_hash,
                                       log_index, previous_status, new_status, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [
      ctx.chainId,
      assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      num(args, 'previousStatus'),
      newStatus,
      ctx.blockTimestamp.toString(),
    ],
  );

  // Guarded on block order so a replayed older log cannot walk the status backwards.
  await tx.query(
    `UPDATE assets SET status = $3, updated_block = $4
      WHERE chain_id = $1 AND asset_id = $2 AND updated_block <= $4`,
    [ctx.chainId, assetId, newStatus, ctx.blockNumber.toString()],
  );
};

const navUpdated: Projector = async (ctx, args, { tx }) => {
  const assetId = hex32(args, 'assetId');
  const newNav = big(args, 'newNAV');
  const navTimestamp = big(args, 'timestamp');

  await tx.query(
    `INSERT INTO nav_history (chain_id, asset_id, block_number, transaction_hash, log_index,
                              previous_nav, new_nav, nav_timestamp, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [
      ctx.chainId,
      assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      big(args, 'previousNAV').toString(),
      newNav.toString(),
      navTimestamp.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );

  await tx.query(
    `UPDATE assets SET current_nav = $3, nav_updated_at = $4, updated_block = $5
      WHERE chain_id = $1 AND asset_id = $2 AND updated_block <= $5`,
    [
      ctx.chainId,
      assetId,
      newNav.toString(),
      navTimestamp.toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

/** `AssetContractsSet` carries six components; the pool arrives only with the factory event. */
const assetContractsSet: Projector = async (ctx, args, deps) => {
  const assetId = hex32(args, 'assetId');
  const contracts = struct(args, 'contracts_');
  await upsertDeployment(ctx, deps, assetId, {
    token: addr(contracts, 'token'),
    vault: addr(contracts, 'vault'),
    offering: addr(contracts, 'offering'),
    marketManager: addr(contracts, 'marketManager'),
    revenueDistributor: addr(contracts, 'revenueDistributor'),
    redemptionController: addr(contracts, 'redemptionController'),
    pool: null,
  });
};

const assetSystemDeployed: Projector = async (ctx, args, deps) => {
  const assetId = hex32(args, 'assetId');
  const deployment = struct(args, 'deployment');
  await upsertDeployment(ctx, deps, assetId, {
    token: addr(deployment, 'token'),
    vault: addr(deployment, 'vault'),
    offering: addr(deployment, 'offering'),
    marketManager: addr(deployment, 'marketManager'),
    revenueDistributor: addr(deployment, 'revenueDistributor'),
    redemptionController: addr(deployment, 'redemptionController'),
    pool: addr(deployment, 'pool'),
  });
};

interface DeploymentAddresses {
  token: `0x${string}`;
  vault: `0x${string}`;
  offering: `0x${string}`;
  marketManager: `0x${string}`;
  revenueDistributor: `0x${string}`;
  redemptionController: `0x${string}`;
  pool: `0x${string}` | null;
}

async function upsertDeployment(
  ctx: LogContext,
  { tx, watched }: ProjectionDeps,
  assetId: string,
  addresses: DeploymentAddresses,
): Promise<void> {
  await tx.query(
    `INSERT INTO asset_deployments (chain_id, asset_id, token, vault, offering, market_manager,
                                    revenue_distributor, redemption_controller, pool, deployed_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (chain_id, asset_id)
     DO UPDATE SET pool = COALESCE(asset_deployments.pool, EXCLUDED.pool)`,
    [
      ctx.chainId,
      assetId,
      addresses.token,
      addresses.vault,
      addresses.offering,
      addresses.marketManager,
      addresses.revenueDistributor,
      addresses.redemptionController,
      addresses.pool,
      ctx.blockNumber.toString(),
    ],
  );

  // Create the aggregate rows now so every later projector can UPDATE without existence checks.
  await tx.query(
    `INSERT INTO token_supply (chain_id, token, asset_id, updated_block)
     VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, token) DO NOTHING`,
    [ctx.chainId, addresses.token, assetId, ctx.blockNumber.toString()],
  );
  await tx.query(
    `INSERT INTO vault_balances (chain_id, vault, asset_id, updated_block)
     VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, vault) DO NOTHING`,
    [ctx.chainId, addresses.vault, assetId, ctx.blockNumber.toString()],
  );

  const discovered: WatchedAddress[] = [
    { address: addresses.token, kind: 'token', assetId },
    { address: addresses.vault, kind: 'vault', assetId },
    { address: addresses.offering, kind: 'offering', assetId },
    { address: addresses.marketManager, kind: 'marketManager', assetId },
    { address: addresses.revenueDistributor, kind: 'revenueDistributor', assetId },
    { address: addresses.redemptionController, kind: 'redemptionController', assetId },
    ...(addresses.pool ? [{ address: addresses.pool, kind: 'pool' as const, assetId }] : []),
  ];

  // Added to the in-memory set and persisted in the same transaction, so a component that
  // emits later in this very block is already watched.
  for (const entry of discovered) {
    watched.add(entry);
    await persistWatched(tx, ctx.chainId, entry, ctx.blockNumber);
  }
}

export const registryProjectors: Record<string, Projector> = {
  AssetSubmitted: assetSubmitted,
  AssetStatusChanged: assetStatusChanged,
  NAVUpdated: navUpdated,
  AssetContractsSet: assetContractsSet,
};

export const factoryProjectors: Record<string, Projector> = {
  AssetSystemDeployed: assetSystemDeployed,
};
