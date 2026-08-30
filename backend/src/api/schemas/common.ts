import { z } from 'zod';
import { getAddress, isAddress } from 'viem';
import { provenanceSchema } from '../envelope.js';

/**
 * Shared request and response primitives.
 *
 * Financial quantities are decimal strings in human units, never JSON numbers: a uint256 has
 * no lossless `number` form, and `0.1 + 0.2` is not a property anyone wants in a ledger.
 * Where the UI might transact on a value it also gets the raw base units.
 */

export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');

export const amountSchema = z.object({
  value: decimalString,
  raw: z.string().regex(/^-?\d+$/),
});

/** A value whose provenance differs from the response envelope's (Boundary C §1). */
export function provenanced<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({ value: valueSchema, provenance: provenanceSchema });
}

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const hash32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const ASSET_STATUS = [
  'Pending',
  'Approved',
  'Active',
  'Suspended',
  'Defaulted',
  'Matured',
  'Closed',
] as const;

export const assetStatusSchema = z.enum(ASSET_STATUS);

/** The registry stores the integer; the API publishes the name. */
export function statusName(status: number): (typeof ASSET_STATUS)[number] {
  const name = ASSET_STATUS[status];
  if (name === undefined) throw new RangeError(`unknown asset status ${status}`);
  return name;
}

export const POSITION_KIND = ['ReserveFloor', 'Anchor', 'Discovery', 'Intermediary'] as const;

export function positionKindName(kind: number): (typeof POSITION_KIND)[number] {
  const name = POSITION_KIND[kind];
  if (name === undefined) throw new RangeError(`unknown position kind ${kind}`);
  return name;
}

export const REDEMPTION_MODE = ['Normal', 'Maturity', 'Emergency'] as const;

export function redemptionModeName(mode: number): (typeof REDEMPTION_MODE)[number] {
  const name = REDEMPTION_MODE[mode];
  if (name === undefined) throw new RangeError(`unknown redemption mode ${mode}`);
  return name;
}

/**
 * `AssetMarketManager.SafetyFailure`. The integers are an interface both consumers hardcode;
 * the names are what a keeper actually needs to read.
 */
export const SAFETY_FAILURE = [
  'None',
  'Paused',
  'AssetNotActive',
  'Matured',
  'StaleNAV',
  'SpotTwapDeviation',
  'MarketNAVDeviation',
  'ReserveBelowMinimum',
  'Cooldown',
] as const;

export function safetyFailureName(failure: number): string {
  return SAFETY_FAILURE[failure] ?? `Unknown(${failure})`;
}

// ---------------------------------------------------------------------------
// Request parameters
// ---------------------------------------------------------------------------

export const assetIdParamSchema = z.object({
  assetId: hash32Schema,
});

export const accountParamsSchema = z.object({
  address: addressSchema,
  assetId: hash32Schema,
});

/** Bounded by default so a client cannot ask for an unbounded scan (BACKEND_INDEXER §16). */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const chainQuerySchema = z.object({
  chainId: z.coerce.number().int().optional(),
});

export function normaliseAddress(value: string): `0x${string}` {
  if (!isAddress(value, { strict: false })) throw new RangeError(`invalid address ${value}`);
  return value.toLowerCase() as `0x${string}`;
}

/** Checksummed for display, per the shared conventions. */
export function displayAddress(value: string): `0x${string}` {
  return getAddress(value);
}

/**
 * A stable, human-readable identifier derived from the asset name. Deterministic so the
 * frontend can route on it; the bytes32 assetId remains the canonical key.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
