import { big, bool, bytes32ToString, hex32, num, type Projector } from './types.js';

/**
 * AssetMarketManager.
 *
 * `liquidity` stays a raw uint128 throughout. Converting it to token amounts needs the real
 * curve and the current price; treating it as an amount is how a UI ends up claiming
 * "7,200 mUSD" of depth that does not exist.
 *
 * `amount0` / `amount1` are stored in token0/token1 order exactly as emitted. Labelling them
 * asset-versus-stable requires `assetIsToken0()` and happens at the API edge, not here.
 */

const positionConfigured: Projector = async (ctx, args, { tx }) => {
  const kind = num(args, 'kind');
  await tx.query(
    `INSERT INTO position_configs (chain_id, market_manager, asset_id, kind, tick_lower,
                                   tick_upper, configured, updated_block)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
     ON CONFLICT (chain_id, market_manager, kind)
     DO UPDATE SET tick_lower = EXCLUDED.tick_lower,
                   tick_upper = EXCLUDED.tick_upper,
                   configured = TRUE,
                   updated_block = EXCLUDED.updated_block`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      kind,
      num(args, 'tickLower'),
      num(args, 'tickUpper'),
      ctx.blockNumber.toString(),
    ],
  );
  await recordPositionEvent(ctx, tx, kind, 'Configured', null, null, null);
};

function liquidityChange(action: 'LiquidityAdded' | 'LiquidityRemoved', sign: 1n | -1n): Projector {
  return async (ctx, args, deps) => {
    const { tx } = deps;
    const kind = num(args, 'kind');
    const liquidity = big(args, 'liquidity');

    // UPDATE only. Liquidity can never precede a range, so a missing row means we lost a
    // PositionConfigured — worth flagging rather than papering over with ticks of 0/0.
    const { rowCount } = await tx.query(
      `UPDATE position_configs SET liquidity = liquidity + $4, updated_block = $5
        WHERE chain_id = $1 AND market_manager = $2 AND kind = $3`,
      [
        ctx.chainId,
        ctx.address,
        kind,
        (sign * liquidity).toString(),
        ctx.blockNumber.toString(),
      ],
    );

    if (rowCount === 0) {
      await deps.flagAnomaly(ctx, 'liquidity_without_configured_position', {
        kind,
        action,
        liquidity: liquidity.toString(),
      });
    }

    await recordPositionEvent(
      ctx,
      tx,
      kind,
      action,
      liquidity,
      big(args, 'amount0'),
      big(args, 'amount1'),
    );
  };
}

const feesCollected: Projector = async (ctx, args, { tx }) => {
  await recordPositionEvent(
    ctx,
    tx,
    num(args, 'kind'),
    'FeesCollected',
    null,
    big(args, 'amount0'),
    big(args, 'amount1'),
  );
};

const rebalanced: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO market_rebalances (chain_id, market_manager, asset_id, block_number,
                                    transaction_hash, log_index, operation, spot_price,
                                    twap_price, nav, anchor_lower, anchor_upper, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.assetId,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      bytes32ToString(hex32(args, 'operation')),
      big(args, 'spotPrice').toString(),
      big(args, 'twapPrice').toString(),
      big(args, 'nav').toString(),
      num(args, 'anchorLower'),
      num(args, 'anchorUpper'),
      ctx.blockTimestamp.toString(),
    ],
  );
};

/**
 * Audit only. These carry amounts but no post-swap tick, and the mock pool does not move
 * price at all, so they can never be aggregated into OHLC (BACKEND_INDEXER section 7).
 */
const swapExecuted: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO manager_swaps (chain_id, market_manager, block_number, transaction_hash,
                                log_index, zero_for_one, amount_in, amount_out,
                                sqrt_price_limit_x96, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      bool(args, 'zeroForOne'),
      big(args, 'amountIn').toString(),
      big(args, 'amountOut').toString(),
      big(args, 'sqrtPriceLimitX96').toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
};

async function recordPositionEvent(
  ctx: Parameters<Projector>[0],
  tx: Parameters<Projector>[2]['tx'],
  kind: number,
  action: string,
  liquidity: bigint | null,
  amount0: bigint | null,
  amount1: bigint | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO position_liquidity_events (chain_id, market_manager, block_number,
                                            transaction_hash, log_index, kind, action,
                                            liquidity, amount0, amount1, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      kind,
      action,
      liquidity === null ? null : liquidity.toString(),
      amount0 === null ? null : amount0.toString(),
      amount1 === null ? null : amount1.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );
}

export const marketProjectors: Record<string, Projector> = {
  PositionConfigured: positionConfigured,
  PositionLiquidityAdded: liquidityChange('LiquidityAdded', 1n),
  PositionLiquidityRemoved: liquidityChange('LiquidityRemoved', -1n),
  FeesCollected: feesCollected,
  Rebalanced: rebalanced,
  SwapExecuted: swapExecuted,
};
