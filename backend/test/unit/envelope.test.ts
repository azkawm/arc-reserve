import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildMeta, envelopeSchema, metaSchema, provenancedSchema, respond } from '../../src/api/envelope.js';
import { ApiError } from '../../src/lib/errors.js';

const CURSOR = { blockNumber: 120n, blockHash: `0x${'ab'.repeat(32)}`, blockTimestamp: 1_786_932_000n };

describe('buildMeta', () => {
  it('reports the indexed block, its hash, and the chain timestamp it was read at', () => {
    const meta = buildMeta({
      chainId: 31337,
      provenance: 'derived',
      staleAfterSeconds: 60,
      cursor: CURSOR,
      latestBlock: 125n,
      now: 1_786_932_010,
    });
    expect(metaSchema.parse(meta)).toEqual({
      chainId: 31337,
      indexedBlock: 120,
      indexedBlockHash: CURSOR.blockHash,
      asOf: 1_786_932_000,
      provenance: 'derived',
      stale: false,
      lagBlocks: 5,
    });
  });

  it('marks a response stale once the indexed block is older than the threshold', () => {
    const meta = buildMeta({
      chainId: 31337,
      provenance: 'derived',
      staleAfterSeconds: 60,
      cursor: CURSOR,
      now: Number(CURSOR.blockTimestamp) + 61,
    });
    expect(meta.stale).toBe(true);
  });

  it('is stale, not fresh, when nothing has been indexed yet', () => {
    // The alternative -- reporting fresh with indexedBlock 0 -- would let the UI present an
    // empty read model as current chain state. D-019.
    const meta = buildMeta({
      chainId: 31337,
      provenance: 'derived',
      staleAfterSeconds: 60,
      cursor: null,
      latestBlock: 42n,
    });
    expect(meta).toMatchObject({ indexedBlock: 0, indexedBlockHash: null, asOf: null, stale: true });
    expect(meta.lagBlocks).toBe(42);
  });

  it('never reports negative lag when the cursor is ahead of a lagging RPC read', () => {
    const meta = buildMeta({
      chainId: 31337,
      provenance: 'onchain',
      staleAfterSeconds: 60,
      cursor: CURSOR,
      latestBlock: 118n,
    });
    expect(meta.lagBlocks).toBe(0);
  });
});

describe('envelope schemas', () => {
  it('accepts only the three provenance values', () => {
    for (const provenance of ['onchain', 'derived', 'mock']) {
      expect(() => metaSchema.parse({ ...validMeta(), provenance })).not.toThrow();
    }
    expect(() => metaSchema.parse({ ...validMeta(), provenance: 'live' })).toThrow();
    expect(() => metaSchema.parse({ ...validMeta(), provenance: 'estimated' })).toThrow();
  });

  it('wraps a per-field provenance object', () => {
    const schema = provenancedSchema(z.string());
    expect(schema.parse({ value: '1.018000', provenance: 'mock' })).toEqual({
      value: '1.018000',
      provenance: 'mock',
    });
    // A bare value with no provenance is exactly the ambiguity the wrapper prevents.
    expect(() => schema.parse({ value: '1.018000' })).toThrow();
  });

  it('requires meta on every envelope', () => {
    const schema = envelopeSchema(z.object({ ok: z.boolean() }));
    expect(() => schema.parse({ data: { ok: true } })).toThrow();
  });
});

describe('respond', () => {
  it('sends the validated envelope with the requested status', () => {
    const reply = fakeReply();
    respond(reply.handle, z.object({ ok: z.boolean() }), { ok: true }, validMeta());
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toEqual({ data: { ok: true }, meta: validMeta() });
  });

  it('refuses to send a payload that does not match its own schema', () => {
    const reply = fakeReply();
    expect(() =>
      respond(reply.handle, z.object({ ok: z.boolean() }), { ok: 'yes' }, validMeta()),
    ).toThrow(ApiError);
    expect(reply.payload).toBeUndefined();
  });

  it('refuses a bigint where the contract promises a number', () => {
    // Financial values leave as decimal strings; block numbers leave as numbers. A raw
    // bigint escaping into JSON would either throw at serialisation or lose precision.
    const reply = fakeReply();
    expect(() =>
      respond(reply.handle, z.object({ block: z.number() }), { block: 120n }, validMeta()),
    ).toThrow(ApiError);
  });
});

function validMeta() {
  return {
    chainId: 31337,
    indexedBlock: 120,
    indexedBlockHash: CURSOR.blockHash,
    asOf: 1_786_932_000,
    provenance: 'derived' as const,
    stale: false,
    lagBlocks: 0,
  };
}

function fakeReply() {
  const state: { statusCode?: number; payload?: unknown } = {};
  const handle = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      state.payload = payload;
      return this;
    },
  };
  return {
    handle: handle as never,
    get statusCode() {
      return state.statusCode;
    },
    get payload() {
      return state.payload;
    },
  };
}
