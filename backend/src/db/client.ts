import pg from 'pg';
import type { Logger } from 'pino';

const { Pool, types } = pg;

/**
 * int8 (BIGINT) arrives as a JavaScript bigint, not a Number: block numbers and timestamps
 * are exact integers and must never round-trip through a float.
 * NUMERIC (oid 1700) keeps pg's default string parser — a uint256 has no lossless JS number
 * form at all, so it stays a string until the caller turns it into a bigint deliberately.
 */
types.setTypeParser(20, (value: string) => BigInt(value));

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** Exactly one row, or a thrown error. Use when zero rows is a bug. */
  one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T>;
  /** Zero or one row. */
  maybe<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
  /**
   * Runs `fn` inside a single transaction. Every ingestion path commits raw logs,
   * projections, block rows and the cursor through exactly one of these, so a crash can
   * never leave the cursor ahead of the data it claims to have indexed.
   */
  withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  close(): Promise<void>;
  readonly pool: pg.Pool;
}

export function createDatabase(connectionString: string, logger?: Logger): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'arcreserve-backend',
  });

  pool.on('error', (error) => {
    logger?.error({ err: error }, 'idle postgres client error');
  });

  const query = async <T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    const result = await pool.query(text, params as never[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  };

  return {
    pool,
    query,
    async one<T>(text: string, params: unknown[] = []): Promise<T> {
      const { rows } = await query<T>(text, params);
      const row = rows[0];
      if (row === undefined) throw new Error(`expected one row, got none: ${text}`);
      return row;
    },
    async maybe<T>(text: string, params: unknown[] = []): Promise<T | null> {
      const { rows } = await query<T>(text, params);
      return rows[0] ?? null;
    },
    async withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          query: async <R>(text: string, params: unknown[] = []) => {
            const result = await client.query(text, params as never[]);
            return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
          },
        };
        const value = await fn(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async ping() {
      const startedAt = process.hrtime.bigint();
      try {
        await pool.query('SELECT 1');
        const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        return { ok: true, latencyMs };
      } catch (error) {
        const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
        return { ok: false, latencyMs, error: (error as Error).message };
      }
    },
    async close() {
      await pool.end();
    },
  };
}
