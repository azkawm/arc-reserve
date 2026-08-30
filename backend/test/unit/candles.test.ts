import { describe, expect, it } from 'vitest';
import { bucketStart, CANDLE_INTERVALS, isCandleInterval } from '../../src/candles/aggregate.js';
import { generateSyntheticCandles } from '../../src/candles/synthetic.js';
import { priceFromSqrtRatioX96 } from '../../src/lib/tick.js';
import { formatFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../../src/lib/decimal.js';

const POOL = '0x75537828f2ce51be7289709686a69cbfdbb714f1';
const SOLAR = { assetIsToken0: true, assetDecimals: TOKEN_DECIMALS, stableDecimals: STABLE_DECIMALS };

describe('bucketStart', () => {
  it('floors to the interval boundary', () => {
    expect(bucketStart(1_786_932_061n, 60)).toBe(1_786_932_060n);
    // 1_786_932_000 is itself a multiple of 3600, so it is its own hour boundary.
    expect(bucketStart(1_786_932_061n, 3600)).toBe(1_786_932_000n);
    expect(bucketStart(1_786_935_600n + 59n, 3600)).toBe(1_786_935_600n);
    expect(bucketStart(1_786_932_061n, 86400)).toBe(1_786_924_800n);

    for (const interval of CANDLE_INTERVALS) {
      const start = bucketStart(1_786_932_061n, interval);
      expect(start % BigInt(interval)).toBe(0n);
      expect(start).toBeLessThanOrEqual(1_786_932_061n);
      expect(start + BigInt(interval)).toBeGreaterThan(1_786_932_061n);
    }
  });

  it('is idempotent on a boundary', () => {
    const start = bucketStart(1_786_932_061n, 3600);
    expect(bucketStart(start, 3600)).toBe(start);
  });

  it('accepts only the six documented intervals', () => {
    expect(CANDLE_INTERVALS).toEqual([60, 300, 900, 3600, 14400, 86400]);
    expect(isCandleInterval(3600)).toBe(true);
    expect(isCandleInterval(120)).toBe(false);
  });
});

describe('priceFromSqrtRatioX96', () => {
  it('agrees with the tick conversion at the same price', () => {
    // sqrt(1) in Q64.96 is 2^96, the same point tick 0 describes.
    const fromSqrt = priceFromSqrtRatioX96(1n << 96n, SOLAR);
    expect(formatFixed(fromSqrt, STABLE_DECIMALS)).toBe('1000000000000.000000');
  });

  it('returns zero for an uninitialised pool rather than dividing by it', () => {
    expect(priceFromSqrtRatioX96(0n, SOLAR)).toBe(0n);
  });

  it('inverts with token ordering', () => {
    const asToken0 = priceFromSqrtRatioX96(1n << 96n, SOLAR);
    const asToken1 = priceFromSqrtRatioX96(1n << 96n, { ...SOLAR, assetIsToken0: false });
    expect(asToken0).toBe(asToken1); // at sqrt=1 the reciprocal is itself
  });
});

describe('generateSyntheticCandles', () => {
  const base = {
    chainId: 31337,
    pool: POOL,
    referencePrice: 1_000_000n, // 1.000000 mUSD
    interval: 3600 as const,
    buckets: 24,
    until: 1_786_932_000n,
  };

  it('is deterministic: the same seed produces the same series', () => {
    const first = generateSyntheticCandles(base);
    const second = generateSyntheticCandles(base);
    expect(first).toEqual(second);
    // Determinism is the property that keeps a demo chart from drifting into looking live.
    expect(first).toHaveLength(24);
  });

  it('produces a different series for a different pool', () => {
    const other = generateSyntheticCandles({ ...base, pool: `0x${'ab'.repeat(20)}` });
    expect(other[0]!.close).not.toBe(generateSyntheticCandles(base)[0]!.close);
  });

  it('emits well-formed candles the database constraint will accept', () => {
    for (const candle of generateSyntheticCandles(base)) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.low).toBeGreaterThan(0n);
      expect(candle.tradeCount).toBeGreaterThan(0);
    }
  });

  it('stays within a modest band of the reference rather than wandering', () => {
    // A demo series that drifted far from NAV would start to look like a market event.
    for (const candle of generateSyntheticCandles(base)) {
      expect(candle.close).toBeGreaterThan((base.referencePrice * 97n) / 100n);
      expect(candle.close).toBeLessThan((base.referencePrice * 103n) / 100n);
    }
  });

  it('chains each bar open to the previous close', () => {
    const candles = generateSyntheticCandles(base);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i]!.open).toBe(candles[i - 1]!.close);
    }
  });

  it('lays buckets on the interval grid, oldest first', () => {
    const candles = generateSyntheticCandles(base);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i]!.bucketStart - candles[i - 1]!.bucketStart).toBe(3600n);
    }
  });

  it('returns nothing when there is no reference price to anchor to', () => {
    expect(generateSyntheticCandles({ ...base, referencePrice: 0n })).toEqual([]);
  });
});
