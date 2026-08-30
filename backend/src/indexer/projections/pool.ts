import { priceFromSqrtRatioX96 } from '../../lib/tick.js';
import { STABLE_DECIMALS, TOKEN_DECIMALS } from '../../lib/decimal.js';
import { applySwapToCandles } from '../../candles/aggregate.js';
import { addr, big, num, type LogContext, type ProjectionDeps, type Projector } from './types.js';

/**
 * Canonical Uniswap V3 pool events.
 *
 * This is the OHLC ingestion path. It is written and tested now even though the demo pool
 * does not yet emit these logs: the alternative — waiting, then meeting the real format for
 * the first time on Base Sepolia — is how an untested path becomes a demo-day surprise.
 *
 * `AssetMarketManager.SwapExecuted` is deliberately NOT a source here. It carries amounts but
 * no post-swap price, so aggregating it would produce candles whose prices came from
 * somewhere other than the trade (BACKEND_INDEXER.md §7).
 */

/**
 * Token ordering, derived from the addresses rather than an RPC call inside the transaction.
 * A Uniswap V3 pool sorts its tokens by address, so this is the ordering by construction —
 * and it must be, because `price` depends on which side is the stablecoin.
 */
function assetIsToken0(assetToken: string, stablecoin: string): boolean {
  return assetToken.toLowerCase() < stablecoin.toLowerCase();
}

interface PoolContext {
  assetToken: string;
  stablecoin: string;
}

async function poolContext(
  { tx }: ProjectionDeps,
  ctx: LogContext,
): Promise<PoolContext | null> {
  if (ctx.assetId === null) return null;
  const { rows } = await tx.query<{ token: string; stablecoin: string }>(
    `SELECT d.token, c.stablecoin_address AS stablecoin
       FROM asset_deployments d
       JOIN chains c ON c.chain_id = d.chain_id
      WHERE d.chain_id = $1 AND d.asset_id = $2`,
    [ctx.chainId, ctx.assetId],
  );
  const row = rows[0];
  return row === undefined ? null : { assetToken: row.token, stablecoin: row.stablecoin };
}

const swap: Projector = async (ctx, args, deps) => {
  const context = await poolContext(deps, ctx);
  if (context === null) {
    await deps.flagAnomaly(ctx, 'swap_without_deployment', { pool: ctx.address });
    return;
  }

  const amount0 = big(args, 'amount0');
  const amount1 = big(args, 'amount1');
  const sqrtPriceX96 = big(args, 'sqrtPriceX96');
  const liquidity = big(args, 'liquidity');
  const tick = num(args, 'tick');

  const isToken0 = assetIsToken0(context.assetToken, context.stablecoin);
  const price = priceFromSqrtRatioX96(sqrtPriceX96, {
    assetIsToken0: isToken0,
    assetDecimals: TOKEN_DECIMALS,
    stableDecimals: STABLE_DECIMALS,
  });

  await deps.tx.query(
    `INSERT INTO pool_swaps (chain_id, pool, block_number, transaction_hash, log_index,
                             transaction_index, sender, recipient, amount0, amount1,
                             sqrt_price_x96, liquidity, tick, price, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      ctx.transactionIndex,
      addr(args, 'sender'),
      addr(args, 'recipient'),
      amount0.toString(),
      amount1.toString(),
      sqrtPriceX96.toString(),
      liquidity.toString(),
      tick,
      price.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );

  // Volume is the absolute size of each leg. The two legs of one swap are the same trade, so
  // summing both as if they were independent would double the reported volume (§10).
  const absolute = (value: bigint): bigint => (value < 0n ? -value : value);
  const volumeAsset = isToken0 ? absolute(amount0) : absolute(amount1);
  const volumeStable = isToken0 ? absolute(amount1) : absolute(amount0);

  await applySwapToCandles(
    deps.tx,
    {
      chainId: ctx.chainId,
      pool: ctx.address,
      price,
      volumeAsset,
      volumeStable,
      blockNumber: ctx.blockNumber,
      transactionIndex: ctx.transactionIndex,
      logIndex: ctx.logIndex,
      timestamp: ctx.blockTimestamp,
    },
    'canonical_swap',
  );
};

/**
 * Only `Swap` is projected. `Initialize`, `Mint`, `Burn` and `Collect` are archived in
 * `raw_logs` and available to the activity feed, but none of them is a trade: seeding a
 * candle from an initialisation price would draw a bar that nobody traded into.
 */
export const poolProjectors: Record<string, Projector> = {
  Swap: swap,
};
