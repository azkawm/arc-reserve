import type { Queryable } from '../../db/client.js';
import type { AddressKind } from '../decode.js';
import type { WatchedSet } from '../watched.js';

export interface LogContext {
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  /** Lowercase. */
  address: `0x${string}`;
  kind: AddressKind;
  /** Resolved from the watched set; null for the registry, factory and stablecoin. */
  assetId: string | null;
}

export interface ProjectionDeps {
  tx: Queryable;
  watched: WatchedSet;
  /**
   * Record a discrepancy without changing state. Used where the chain tells us something
   * that contradicts our own arithmetic — the emitted category balance disagreeing with the
   * applied delta, for instance. Flag the row, never overwrite silently.
   */
  flagAnomaly(ctx: LogContext, kind: string, detail: Record<string, unknown>): Promise<void>;
}

export type Projector = (
  ctx: LogContext,
  args: Record<string, unknown>,
  deps: ProjectionDeps,
) => Promise<void>;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Read a uint/int argument as bigint. Throws rather than coercing an unexpected shape. */
export function big(args: Record<string, unknown>, key: string): bigint {
  const value = args[key];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`expected bigint arg "${key}", got ${typeof value}`);
}

export function num(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`expected numeric arg "${key}", got ${typeof value}`);
}

export function bool(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  throw new TypeError(`expected boolean arg "${key}", got ${typeof value}`);
}

/** Addresses are stored lowercase everywhere; checksumming happens at the API edge. */
export function addr(args: Record<string, unknown>, key: string): `0x${string}` {
  const value = args[key];
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`expected address arg "${key}", got ${String(value)}`);
  }
  return value.toLowerCase() as `0x${string}`;
}

export function hex32(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`expected bytes32 arg "${key}", got ${String(value)}`);
  }
  return value.toLowerCase();
}

export function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new TypeError(`expected string arg "${key}"`);
  return value;
}

/** Decode a left-aligned bytes32 string literal such as `"REDEMPTION_RESERVE"`. */
export function bytes32ToString(value: string): string {
  const body = value.replace(/^0x/, '');
  let out = '';
  for (let i = 0; i < body.length; i += 2) {
    const byte = Number.parseInt(body.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** A struct argument returned by viem as a named object. */
export function struct(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`expected struct arg "${key}"`);
  }
  return value as Record<string, unknown>;
}
