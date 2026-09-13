/**
 * Tick ↔ human price for the canonical Uniswap V3 pool.
 *
 * The same human price is tick `t` under one token ordering and `-t` under the other, so every
 * helper takes the ordering. `assetIsToken0` moves with the deployer's nonce, and the two live
 * chains happening to agree today is exactly when an ordering bug hides (INTEGRATION_GUIDE §1.2).
 *
 * These are floating-point by nature — a tick is a logarithm — and are used for display and range
 * math only, never for a value a wallet sends.
 */

const TICK_BASE = 1.0001;

export function tickToPrice(
  tick: number,
  assetIsToken0: boolean,
  assetDecimals = 18,
  stableDecimals = 6,
): number {
  const raw = TICK_BASE ** tick;
  const decimalScale = 10 ** (assetDecimals - stableDecimals);
  return assetIsToken0 ? raw * decimalScale : (1 / raw) * decimalScale;
}

export function priceToTick(
  price: number,
  assetIsToken0: boolean,
  assetDecimals = 18,
  stableDecimals = 6,
): number {
  const decimalScale = 10 ** (assetDecimals - stableDecimals);
  const ratio = assetIsToken0 ? price / decimalScale : decimalScale / price;
  return Math.log(ratio) / Math.log(TICK_BASE);
}
