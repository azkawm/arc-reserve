/**
 * Exact base-unit arithmetic and formatting.
 *
 * Rule (CLAUDE.md, D-019): no floats anywhere in storage or arithmetic. Every quantity in
 * this service is a `bigint` of base units until the moment it becomes a decimal string in
 * an HTTP response. `Number`, `parseFloat` and `toFixed` are never applied to money.
 */

/** SOLAR01 and every asset token. */
export const TOKEN_DECIMALS = 18;
/** mUSD, NAV, quoted prices, redemption price, spot, TWAP — mUSD base units per whole token. */
export const STABLE_DECIMALS = 6;
/** 10_000 = 100%. */
export const BPS_DENOMINATOR = 10_000n;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Format base units as a fixed-scale decimal string: `formatFixed(1018000n, 6) === "1.018000"`.
 * Trailing zeros are kept so the scale of a value is visible in the response.
 */
export function formatFixed(raw: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const body =
    decimals === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(decimals, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Parse a decimal string into base units without ever constructing a float.
 * Rejects exponent notation and any fraction finer than `decimals`, because silently
 * truncating a user-supplied amount is how rounding bugs enter a ledger.
 */
export function parseFixed(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!DECIMAL_STRING.test(value)) {
    throw new RangeError(`not a decimal string: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (fraction.length > decimals) {
    throw new RangeError(`${value} has more than ${decimals} decimal places`);
  }
  const raw = BigInt(whole + fraction.padEnd(decimals, '0'));
  return negative ? -raw : raw;
}

/** The `{ value, raw }` pair Boundary C requires wherever the UI might transact. */
export interface Amount {
  value: string;
  raw: string;
}

export function amount(raw: bigint, decimals: number): Amount {
  return { value: formatFixed(raw, decimals), raw: raw.toString() };
}

export const tokenAmount = (raw: bigint): Amount => amount(raw, TOKEN_DECIMALS);
export const stableAmount = (raw: bigint): Amount => amount(raw, STABLE_DECIMALS);

/**
 * `Math.mulDiv` semantics from the contracts: full-precision multiply, floor division.
 * Matching the Solidity rounding direction is what keeps a derived value equal to the
 * onchain one instead of one wei away from it.
 */
export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('mulDiv: division by zero');
  const product = a * b;
  if (product >= 0n === denominator > 0n) return product / denominator;
  // BigInt division truncates toward zero; floor for a negative quotient.
  const quotient = product / denominator;
  return quotient * denominator === product ? quotient : quotient - 1n;
}

/** `DecimalMath.applyBps` — floor, same as the contracts. */
export function applyBps(value: bigint, bps: number | bigint): bigint {
  return mulDiv(value, BigInt(bps), BPS_DENOMINATOR);
}

/**
 * Ratio in basis points, floored. Returns null when the denominator is zero rather than
 * inventing an infinity: "no supply" is not "infinite reserve ratio".
 */
export function ratioBps(numerator: bigint, denominator: bigint): bigint | null {
  if (denominator === 0n) return null;
  return mulDiv(numerator, BPS_DENOMINATOR, denominator);
}

/** Convert between two scales exactly; throws rather than losing precision downward. */
export function rescale(raw: bigint, from: number, to: number): bigint {
  assertDecimals(from);
  assertDecimals(to);
  if (from === to) return raw;
  if (to > from) return raw * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  if (raw % divisor !== 0n) {
    throw new RangeError(`rescale ${raw} from ${from}d to ${to}d would lose precision`);
  }
  return raw / divisor;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new RangeError(`invalid decimals: ${decimals}`);
  }
}
