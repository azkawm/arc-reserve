import { describe, expect, it } from 'vitest';
import { getSqrtRatioAtTick, priceAtTick, MAX_TICK, MIN_TICK } from '../../src/lib/tick.js';
import { formatFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../../src/lib/decimal.js';

const Q96 = 1n << 96n;

const SOLAR = { assetIsToken0: true, assetDecimals: TOKEN_DECIMALS, stableDecimals: STABLE_DECIMALS };
const FLIPPED = { ...SOLAR, assetIsToken0: false };

describe('getSqrtRatioAtTick', () => {
  it('is exactly 2^96 at tick 0', () => {
    expect(getSqrtRatioAtTick(0)).toBe(Q96);
  });

  it('is monotonically increasing', () => {
    let previous = getSqrtRatioAtTick(-5000);
    for (let tick = -4900; tick <= 5000; tick += 100) {
      const current = getSqrtRatioAtTick(tick);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('matches the known Uniswap boundary ratios', () => {
    // The canonical MIN_SQRT_RATIO / MAX_SQRT_RATIO from TickMath.
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(4295128739n);
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
  });

  it('rejects a tick outside the representable range', () => {
    expect(() => getSqrtRatioAtTick(MIN_TICK - 1)).toThrow(/out of range/);
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(/out of range/);
    expect(() => getSqrtRatioAtTick(1.5)).toThrow(/out of range/);
  });
});

describe('priceAtTick', () => {
  it('prices the seeded anchor range at roughly 1 mUSD per SOLAR01', () => {
    // DeployLocal seeds the anchor at [-276600, -276000] with the asset as token0. With
    // 18/6 decimals the 1.0 mUSD price sits near tick -276324, so the range must straddle it.
    const lower = priceAtTick(-276600, SOLAR);
    const upper = priceAtTick(-276000, SOLAR);

    expect(Number(formatFixed(lower, STABLE_DECIMALS))).toBeGreaterThan(0.9);
    expect(Number(formatFixed(lower, STABLE_DECIMALS))).toBeLessThan(1.0);
    expect(Number(formatFixed(upper, STABLE_DECIMALS))).toBeGreaterThan(1.0);
    expect(Number(formatFixed(upper, STABLE_DECIMALS))).toBeLessThan(1.1);
  });

  it('accounts for the 12-decimal gap between an 18d token and a 6d stablecoin', () => {
    // At tick 0 one base unit of each token trades 1:1, so one WHOLE 18-decimal asset is
    // worth 10^12 whole mUSD. A conversion that ignored decimals would return 1.0 here.
    expect(formatFixed(priceAtTick(0, SOLAR), STABLE_DECIMALS)).toBe('1000000000000.000000');
  });

  it('inverts when the stablecoin is token0', () => {
    // Same tick, opposite ordering: the price is the reciprocal.
    const asToken0 = priceAtTick(-276324, SOLAR);
    const asToken1 = priceAtTick(276324, FLIPPED);
    const difference = asToken0 > asToken1 ? asToken0 - asToken1 : asToken1 - asToken0;
    // Both round the same sqrt ratio, so they agree to within a base unit.
    expect(difference).toBeLessThanOrEqual(1n);
  });

  it('rises with the tick when the asset is token0 and falls when it is token1', () => {
    expect(priceAtTick(-276000, SOLAR)).toBeGreaterThan(priceAtTick(-276600, SOLAR));
    expect(priceAtTick(276000, FLIPPED)).toBeLessThan(priceAtTick(275400, FLIPPED));
  });

  it('never uses a float: a large tick keeps full integer precision', () => {
    const price = priceAtTick(200000, SOLAR);
    expect(typeof price).toBe('bigint');
    // A double would have collapsed the low-order digits of a number this size.
    expect(price.toString().length).toBeGreaterThan(15);
  });
});
