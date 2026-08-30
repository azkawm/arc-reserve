import { describe, expect, it } from 'vitest';
import {
  applyBps,
  amount,
  formatFixed,
  mulDiv,
  parseFixed,
  ratioBps,
  rescale,
  STABLE_DECIMALS,
  TOKEN_DECIMALS,
} from '../../src/lib/decimal.js';

describe('formatFixed', () => {
  it('keeps the full scale so the precision of a value is visible', () => {
    expect(formatFixed(1_018_000n, STABLE_DECIMALS)).toBe('1.018000');
    expect(formatFixed(20_000_000_000n, STABLE_DECIMALS)).toBe('20000.000000');
    expect(formatFixed(1n, STABLE_DECIMALS)).toBe('0.000001');
    expect(formatFixed(0n, STABLE_DECIMALS)).toBe('0.000000');
  });

  it('formats 18-decimal token amounts exactly', () => {
    expect(formatFixed(20_000n * 10n ** 18n, TOKEN_DECIMALS)).toBe('20000.000000000000000000');
    expect(formatFixed(1n, TOKEN_DECIMALS)).toBe('0.000000000000000001');
  });

  it('survives a value larger than Number.MAX_SAFE_INTEGER', () => {
    const raw = 2n ** 200n;
    expect(formatFixed(raw, 0)).toBe(raw.toString());
  });

  it('formats negative deltas', () => {
    expect(formatFixed(-2_500_000n, STABLE_DECIMALS)).toBe('-2.500000');
  });

  it('supports a zero scale', () => {
    expect(formatFixed(1200n, 0)).toBe('1200');
  });
});

describe('parseFixed', () => {
  it('round-trips through base units', () => {
    expect(parseFixed('1.018000', STABLE_DECIMALS)).toBe(1_018_000n);
    expect(parseFixed('20000', STABLE_DECIMALS)).toBe(20_000_000_000n);
    expect(parseFixed('-2.5', STABLE_DECIMALS)).toBe(-2_500_000n);
  });

  it('refuses to silently truncate precision it cannot hold', () => {
    expect(() => parseFixed('1.0000001', STABLE_DECIMALS)).toThrow(/decimal places/);
  });

  it('rejects anything that is not a plain decimal string', () => {
    for (const bad of ['1e6', '0x10', '', '1.2.3', 'NaN', 'Infinity', ' 1.0']) {
      expect(() => parseFixed(bad, STABLE_DECIMALS)).toThrow();
    }
  });
});

describe('mulDiv', () => {
  it('floors, matching Solidity Math.mulDiv', () => {
    expect(mulDiv(7n, 1n, 2n)).toBe(3n);
    expect(mulDiv(1n, 1n, 3n)).toBe(0n);
  });

  it('floors negative quotients downward rather than toward zero', () => {
    // BigInt division truncates: -7n / 2n === -3n. Floor is -4n.
    expect(mulDiv(-7n, 1n, 2n)).toBe(-4n);
    expect(mulDiv(7n, 1n, -2n)).toBe(-4n);
    expect(mulDiv(-8n, 1n, 2n)).toBe(-4n);
  });

  it('does not overflow on full uint256-scale products', () => {
    const big = 2n ** 255n;
    expect(mulDiv(big, 2n, 4n)).toBe(big / 2n);
  });

  it('rejects division by zero', () => {
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(/division by zero/);
  });
});

describe('applyBps', () => {
  it('reproduces the settlement split on a whole mUSD amount', () => {
    // PrimaryOffering under D-023: 65 issuer / 30 reserve / 5 market. These bps are the
    // contract's today and have already changed once; the projections store the *emitted*
    // share values, so this test covers the arithmetic, not the policy.
    const stablecoin = 1_000_000_000n; // 1,000 mUSD
    expect(applyBps(stablecoin, 6_500)).toBe(650_000_000n);
    expect(applyBps(stablecoin, 3_000)).toBe(300_000_000n);
    expect(applyBps(stablecoin, 500)).toBe(50_000_000n);
    expect(
      applyBps(stablecoin, 6_500) + applyBps(stablecoin, 3_000) + applyBps(stablecoin, 500),
    ).toBe(stablecoin);
  });

  it('reproduces the revenue split and shows the rounding dust the contract leaves', () => {
    // RevenueDistributor: 60 / 25 / 10 / 5.
    const gross = 1n; // one mUSD base unit
    const shares = [6_000, 2_500, 1_000, 500].map((bps) => applyBps(gross, bps));
    expect(shares).toEqual([0n, 0n, 0n, 0n]);
    // Every share floors to zero, so the sum is under the gross. The projection must record
    // the emitted amounts rather than assume they add up to the deposit.
    expect(shares.reduce((a, b) => a + b, 0n)).toBeLessThan(gross);
  });
});

describe('ratioBps', () => {
  it('computes a reserve ratio in basis points', () => {
    // 20,000 mUSD reserve against 80,000 mUSD of NAV-valued obligations = 25%.
    expect(ratioBps(20_000_000_000n, 80_000_000_000n)).toBe(2_500n);
  });

  it('returns null for a zero denominator instead of inventing an infinity', () => {
    expect(ratioBps(1n, 0n)).toBeNull();
  });
});

describe('rescale', () => {
  it('widens 6-decimal mUSD to 18 decimals exactly', () => {
    expect(rescale(1_018_000n, 6, 18)).toBe(1_018_000n * 10n ** 12n);
  });

  it('refuses a narrowing conversion that would lose precision', () => {
    expect(() => rescale(1n, 18, 6)).toThrow(/lose precision/);
    expect(rescale(10n ** 12n, 18, 6)).toBe(1n);
  });
});

describe('amount', () => {
  it('carries both the human string and the raw base units', () => {
    expect(amount(1_018_000n, STABLE_DECIMALS)).toEqual({ value: '1.018000', raw: '1018000' });
  });
});
