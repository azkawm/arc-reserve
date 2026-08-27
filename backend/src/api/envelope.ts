import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { ApiError } from '../lib/errors.js';

/**
 * The response envelope from Boundary C section 1.
 *
 * Two rules are enforced here rather than trusted to each route:
 *  - every response states its provenance, and a `mock` value is never labelled otherwise;
 *  - every payload is parsed against its own Zod schema before it leaves the process, so a
 *    shape the frontend was promised cannot silently drift.
 */

export const PROVENANCE = ['onchain', 'derived', 'mock'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const provenanceSchema = z.enum(PROVENANCE);

export const metaSchema = z.object({
  chainId: z.number().int(),
  /** Highest block whose logs and projections are committed. 0 before the first block. */
  indexedBlock: z.number().int().nonnegative(),
  /** Null until the first block is indexed (CHANGED 2026-08-27). */
  indexedBlockHash: z.string().nullable(),
  /** Chain timestamp of that block, unix seconds. Null before the first block. */
  asOf: z.number().int().nullable(),
  provenance: provenanceSchema,
  stale: z.boolean(),
  lagBlocks: z.number().int().nonnegative(),
});

export type Meta = z.infer<typeof metaSchema>;

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function envelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema, meta: metaSchema });
}

/** A single field whose provenance differs from the response as a whole (mock OHLC in a
 *  derived response, for example). Boundary C section 1. */
export function provenancedSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({ value: valueSchema, provenance: provenanceSchema });
}

export interface CursorPosition {
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
}

export interface BuildMetaInput {
  chainId: number;
  provenance: Provenance;
  staleAfterSeconds: number;
  cursor: CursorPosition | null;
  latestBlock?: bigint | null;
  /** Injectable for deterministic tests. Unix seconds. */
  now?: number;
}

export function buildMeta({
  chainId,
  provenance,
  staleAfterSeconds,
  cursor,
  latestBlock = null,
  now = Math.floor(Date.now() / 1000),
}: BuildMetaInput): Meta {
  if (cursor === null) {
    return {
      chainId,
      indexedBlock: 0,
      indexedBlockHash: null,
      asOf: null,
      provenance,
      // Nothing has been indexed, so nothing here is current. Saying so is the point.
      stale: true,
      lagBlocks: latestBlock === null ? 0 : Number(latestBlock),
    };
  }

  const asOf = Number(cursor.blockTimestamp);
  return {
    chainId,
    indexedBlock: Number(cursor.blockNumber),
    indexedBlockHash: cursor.blockHash,
    asOf,
    provenance,
    stale: now - asOf > staleAfterSeconds,
    lagBlocks:
      latestBlock === null ? 0 : Math.max(0, Number(latestBlock - cursor.blockNumber)),
  };
}

/**
 * Validate and send. A schema mismatch is an internal error, never a partially-shaped
 * response: the frontend codes against this contract and a silent extra/missing field is
 * exactly the drift Boundary C exists to prevent.
 */
export function respond<T extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: T,
  data: unknown,
  meta: Meta,
  statusCode = 200,
): FastifyReply {
  const parsed = envelopeSchema(schema).safeParse({ data, meta });
  if (!parsed.success) {
    throw ApiError.internal('response failed its own schema', parsed.error.issues);
  }
  return reply.status(statusCode).send(parsed.data);
}
