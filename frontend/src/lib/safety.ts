/**
 * `AssetMarketManager.SafetyFailure`, in order. The API serves the decoded name at
 * `metrics.safety.failure`, so this exists for the numeric form and to keep the mapping honest.
 *
 * Codes **4 (`StaleNAV`), 5 (`SpotTwapDeviation`) and 6 (`MarketNAVDeviation`)** are reserved and
 * never returned: D-036 removed the TWAP, and D-039 made NAV gate nothing in the market engine.
 * They stay in the array on purpose — deleting them would shift `ReserveBelowMinimum` and
 * `Cooldown` down, and every keeper message that reads this map would silently become wrong.
 */
export const SAFETY_FAILURE = [
  "None",
  "Paused",
  "AssetNotActive",
  "Matured",
  "StaleNAV",
  "SpotTwapDeviation",
  "MarketNAVDeviation",
  "ReserveBelowMinimum",
  "Cooldown",
] as const;

export type SafetyFailure = (typeof SAFETY_FAILURE)[number];

export const RESERVED_SAFETY_FAILURES: ReadonlySet<number> = new Set([4, 5, 6]);

export function safetyFailureName(index: number): string {
  return SAFETY_FAILURE[index] ?? `Unknown(${index})`;
}
