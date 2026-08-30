import { applyYieldExclusion } from './token.js';
import {
  addr,
  big,
  bool,
  hex32,
  num,
  type LogContext,
  type ProjectionDeps,
  type Projector,
} from './types.js';

/**
 * PrimaryOffering, RevenueDistributor and RedemptionController — the three contracts that
 * move money between investors and the vault.
 *
 * Every split value is stored **as emitted**. The offering split (70/20/10 today, 65/30/5
 * under D-023) and the revenue split (60/25/10/5, becoming admin-settable with a
 * behind-schedule variant) are both changing; a share recomputed from a hardcoded bps
 * constant would silently diverge from the chain the moment either lands.
 */

const tokensPurchased: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO offering_purchases (chain_id, offering, asset_id, block_number, transaction_hash,
                                     log_index, buyer, stablecoin_amount, token_amount,
                                     issuer_share, reserve_share, market_share, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      addr(args, 'buyer'),
      big(args, 'stablecoinAmount').toString(),
      big(args, 'tokenAmount').toString(),
      big(args, 'issuerShare').toString(),
      big(args, 'reserveShare').toString(),
      big(args, 'marketShare').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

const revenueDeposited: Projector = async (ctx, args, { tx }) => {
  // periodId / reportHash / behindSchedule arrived with D-022 and D-023. They are read
  // defensively so a chain deployed before that change still indexes.
  const periodId = 'periodId' in args ? big(args, 'periodId').toString() : null;
  const reportHash = 'reportHash' in args ? hex32(args, 'reportHash') : null;
  const behindSchedule = 'behindSchedule' in args ? bool(args, 'behindSchedule') : null;

  await tx.query(
    `INSERT INTO revenue_deposits (chain_id, distributor, asset_id, block_number,
                                   transaction_hash, log_index, depositor, period_id,
                                   report_hash, behind_schedule, gross_amount, holder_amount,
                                   reserve_amount, operator_amount, protocol_amount,
                                   block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      addr(args, 'depositor'),
      periodId,
      reportHash,
      behindSchedule,
      big(args, 'grossAmount').toString(),
      big(args, 'holderAmount').toString(),
      big(args, 'reserveAmount').toString(),
      big(args, 'operatorAmount').toString(),
      big(args, 'protocolAmount').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

function revenueClaim(kind: 'holder' | 'operator', argName: string): Projector {
  return async (ctx, args, { tx }) => {
    await tx.query(
      `INSERT INTO revenue_claims (chain_id, distributor, asset_id, block_number,
                                   transaction_hash, log_index, claimant, claim_kind, amount,
                                   block_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        ctx.chainId,
        ctx.address,
        ctx.assetId,
        ctx.blockNumber.toString(),
        ctx.transactionHash,
        ctx.logIndex,
        addr(args, argName),
        kind,
        big(args, 'amount').toString(),
        ctx.blockTimestamp.toString(),
      ],
    );
  };
}

/**
 * Emitted by the distributor, but it changes the token's yield-eligible denominator, so it
 * is applied to that asset's token row.
 */
const yieldExclusionChanged: Projector = async (ctx, args, deps) => {
  const token = await tokenForAsset(deps, ctx);
  if (token === null) {
    await deps.flagAnomaly(ctx, 'yield_exclusion_without_deployment', { assetId: ctx.assetId });
    return;
  }
  await applyYieldExclusion(
    deps.tx,
    ctx,
    token,
    addr(args, 'account'),
    bool(args, 'excluded'),
    big(args, 'accountBalance'),
  );
};

const redeemed: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO redemptions (chain_id, controller, asset_id, block_number, transaction_hash,
                              log_index, holder, mode, token_amount, stablecoin_amount, nav,
                              redemption_price, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      addr(args, 'holder'),
      num(args, 'mode'),
      big(args, 'tokenAmount').toString(),
      big(args, 'stablecoinAmount').toString(),
      big(args, 'nav').toString(),
      big(args, 'redemptionPrice').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

async function tokenForAsset(
  { tx }: ProjectionDeps,
  ctx: LogContext,
): Promise<`0x${string}` | null> {
  if (ctx.assetId === null) return null;
  const { rows } = await tx.query<{ token: string }>(
    'SELECT token FROM asset_deployments WHERE chain_id = $1 AND asset_id = $2',
    [ctx.chainId, ctx.assetId],
  );
  return (rows[0]?.token as `0x${string}`) ?? null;
}

export const offeringProjectors: Record<string, Projector> = {
  TokensPurchased: tokensPurchased,
};

export const revenueProjectors: Record<string, Projector> = {
  RevenueDeposited: revenueDeposited,
  RevenueClaimed: revenueClaim('holder', 'holder'),
  OperatorRevenueClaimed: revenueClaim('operator', 'operator'),
  YieldExclusionChanged: yieldExclusionChanged,
};

export const redemptionProjectors: Record<string, Projector> = {
  Redeemed: redeemed,
};
