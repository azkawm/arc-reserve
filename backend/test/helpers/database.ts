import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type Database } from '../../src/db/client.js';

/**
 * Integration tests run against a real PostgreSQL, because the properties under test —
 * domain constraints, composite primary keys, cascade rollback, transactional cursor
 * advancement — do not exist in a mock. `npm run db:up` starts one.
 *
 * The suite fails loudly rather than skipping when no database is reachable: a silently
 * skipped integrity test is worse than a red one.
 */

const DEFAULT_URL = 'postgresql://arcreserve:arcreserve@127.0.0.1:5450/arcreserve_test';
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

let cached: Database | null = null;
let prepared: Promise<void> | null = null;

export async function testDatabase(): Promise<Database> {
  prepared ??= prepare();
  await prepared;
  cached ??= createDatabase(TEST_DATABASE_URL);
  return cached;
}

export async function closeTestDatabase(): Promise<void> {
  await cached?.close();
  cached = null;
}

/**
 * Wipe every projection between tests while keeping the schema and migration history.
 *
 * Enumerated from the catalogue rather than hardcoded. Naming a few tables and relying on
 * `CASCADE` for the rest is wrong here: the current-state aggregates (`token_supply`,
 * `vault_balances`, `token_balances`, ...) have no foreign key to `chains`, so a cascade
 * misses them entirely and a supposedly fresh replay double-applies onto stale balances.
 */
export async function truncateAll(db: Database): Promise<void> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> 'pgmigrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.table_name}"`).join(', ');
  await db.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

async function prepare(): Promise<void> {
  await ensureDatabaseExists();
  await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}

async function ensureDatabaseExists(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `cannot reach PostgreSQL at ${adminUrl.host}: ${(error as Error).message}\n` +
        'Start it with `npm run db:up` (or set TEST_DATABASE_URL).',
    );
  }

  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (rowCount === 0) {
      // Identifier interpolation: the name comes from our own config, and pg has no
      // parameter binding for DDL identifiers.
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
    }
  } finally {
    await admin.end();
  }
}
