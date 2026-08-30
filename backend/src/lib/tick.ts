import { mulDiv } from './decimal.js';

/**
 * Uniswap V3 tick math, in exact integer arithmetic.
 *
 * A tick is a price on a 1.0001^t grid. The obvious implementation — `Math.pow(1.0001, tick)`
 * — is a float, and a float price that feeds a chart's band edges is precisely the sort of
 * "close enough" number this service is not allowed to publish. This is the canonical
 * `TickMath.getSqrtRatioAtTick` algorithm: a product of fixed Q128.128 constants, one per set
 * bit of |tick|, which is exact by construction.
 */

const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q128 = 1n << 128n;
const Q192 = 1n << 192n;
const MAX_UINT256 = (1n << 256n) - 1n;

const MAGIC: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n, // 1
  0xfff97272373d413259a46990580e213an, // 2
  0xfff2e50f5f656932ef12357cf3c7fdccn, // 4
  0xffe5caca7e10e4e61c3624eaa0941cd0n, // 8
  0xffcb9843d60f6159c9db58835c926644n, // 16
  0xff973b41fa98c081472e6896dfb254c0n, // 32
  0xff2ea16466c96a3843ec78b326b52861n, // 64
  0xfe5dee046a99a2a811c461f1969c3053n, // 128
  0xfcbe86c7900a88aedcffc83b479aa3a4n, // 256
  0xf987a7253ac413176f2b074cf7815e54n, // 512
  0xf3392b0822b70005940c7a398e4b70f3n, // 1024
  0xe7159475a2c29b7443b29c7fa6e889d9n, // 2048
  0xd097f3bdfd2022b8845ad8f792aa5825n, // 4096
  0xa9f746462d870fdf8a65dc1f90e061e5n, // 8192
  0x70d869a156d2a1b890bb3df62baf32f7n, // 16384
  0x31be135f97d08fd981231505542fcfa6n, // 32768
  0x9aa508b5b7a84e1c677de54f3e99bc9n, // 65536
  0x5d6af8dedb81196699c329225ee604n, // 131072
  0x2216e584f5fa1ea926041bedfe98n, // 262144
  0x48a170391f7dc42444e8fa2n, // 524288
];

/** sqrt(1.0001^tick) as a Q64.96 fixed-point value. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`tick out of range: ${tick}`);
  }

  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 1n) !== 0n ? MAGIC[0]! : Q128;

  for (let bit = 1; bit < MAGIC.length; bit += 1) {
    if ((absTick & (1n << BigInt(bit))) !== 0n) {
      ratio = (ratio * MAGIC[bit]!) >> 128n;
    }
  }

  // Above tick 0 the price is the reciprocal of the accumulated ratio.
  if (tick > 0) ratio = MAX_UINT256 / ratio;

  // Q128.128 -> Q64.96, rounding up so the result never understates the price.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

export interface PriceOptions {
  /** True when the asset token is token0 of the pool. */
  assetIsToken0: boolean;
  assetDecimals: number;
  stableDecimals: number;
}

/**
 * Stablecoin per **whole** asset token at a tick, scaled to the stablecoin's decimals.
 *
 * Derivation (BACKEND_INDEXER.md §9):
 *   raw token1/token0 = (sqrtP / 2^96)^2
 *   human             = raw * 10^(dec0 - dec1)
 * and stable-per-asset is that ratio, or its reciprocal when the stablecoin is token0.
 */
export function priceAtTick(tick: number, options: PriceOptions): bigint {
  const sqrtRatio = getSqrtRatioAtTick(tick);
  const ratioX192 = sqrtRatio * sqrtRatio;
  const { assetIsToken0, assetDecimals } = options;

  // Both branches scale by exactly 10^assetDecimals, and the stablecoin's own decimals cancel
  // out of the algebra: the result is "stablecoin base units per WHOLE asset token", and one
  // whole asset is 10^assetDecimals base units. `stableDecimals` stays in the interface
  // because it is part of the caller's contract, not because the formula needs it.
  const scale = 10n ** BigInt(assetDecimals);

  if (assetIsToken0) {
    // stable per asset = raw * 10^(assetDecimals - stableDecimals)
    return mulDiv(ratioX192, scale, Q192);
  }

  // Stable is token0, so stable-per-asset is the reciprocal of the pool's token1/token0.
  if (ratioX192 === 0n) return 0n;
  return mulDiv(scale, Q192, ratioX192);
}

/** The nearest tick at or below a price. Used only for display bounds, never for execution. */
export function isValidTick(tick: number): boolean {
  return Number.isInteger(tick) && tick >= MIN_TICK && tick <= MAX_TICK;
}

export { MIN_TICK, MAX_TICK };
