/**
 * Display formatting for values the API already delivered as exact decimal strings.
 *
 * Nothing here does money *arithmetic*. The backend has already done that in integers and
 * handed over a string like `"1.018000"`; these helpers only decide how many of those digits
 * to show. Where a chart library needs a JavaScript number, that conversion is a rendering
 * concern and is marked as such — it never feeds a number back into a balance or a total.
 */

/** Trim a fixed-scale decimal string to at most `maxDecimals`, without float rounding. */
export function trimDecimals(value: string, maxDecimals: number): string {
  const [whole, fraction = ""] = value.split(".");
  if (maxDecimals <= 0) return whole ?? "0";
  const kept = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return kept.length === 0 ? (whole ?? "0") : `${whole}.${kept}`;
}

/** Group the integer part with thin separators: `"24600.000000"` -> `"24,600"`. */
export function formatAmount(value: string | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined) return "—";
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const trimmed = trimDecimals(unsigned, maxDecimals);
  const [whole = "0", fraction] = trimmed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return negative ? `-${body}` : body;
}

/** A price, always to three decimals so `1.018` and `0.820` line up in a column. */
export function formatPrice(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(3, "0").slice(0, 3)}`;
}

/** `"24600.000000"` -> `"24.6k"`. Integer-part arithmetic only. */
export function formatCompact(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const [whole = "0"] = value.split(".");
  const digits = whole.replace("-", "");
  const sign = whole.startsWith("-") ? "-" : "";

  if (digits.length > 6) {
    const millions = digits.slice(0, digits.length - 6);
    const tenths = digits[digits.length - 6];
    return `${sign}${millions}.${tenths}M`;
  }
  if (digits.length > 3) {
    const thousands = digits.slice(0, digits.length - 3);
    const tenths = digits[digits.length - 3];
    return `${sign}${thousands}.${tenths}k`;
  }
  return `${sign}${digits}`;
}

/** Signed percent, with trailing zeros trimmed: `"1.80"` -> `"+1.8%"`. */
export function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value.startsWith("-") ? "" : "+";
  return `${sign}${trimDecimals(value, 2)}%`;
}

/** Basis points as a percentage: `"2500"` -> `"25.00%"`. */
export function formatBps(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const bps = BigInt(String(value));
  const whole = bps / 100n;
  const fraction = (bps % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}

export function formatDate(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined || unixSeconds === 0) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return "—";
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Decimal string to a JavaScript number, for chart plotting only.
 *
 * Recharts needs numbers to compute pixel positions. That is a rendering concern: the value
 * is already a display string the backend computed exactly, and the result of this call never
 * re-enters a balance, a total, or anything a user transacts on.
 */
export function toPlotNumber(value: string): number {
  return Number(value);
}
