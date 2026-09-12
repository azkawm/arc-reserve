#!/usr/bin/env node
/**
 * Receipt diff: does the indexer hold every log the deployment actually emitted?
 *
 *   node scripts/verify-receipts.mjs <chainId>
 *
 * A deployment's broadcast receipts are an exact, independent list of the logs its transactions
 * emitted. The indexer must have stored every one of them emitted by a contract it watches, up to
 * its cursor — no fewer, no more. That is the only check in the pipeline that catches a cursor
 * sitting in the right place over incomplete data: lag, health and anomalies all read "fine" then.
 * On Arc (2026-09-13) exactly that happened — 17 deployment logs missing behind a healthy-looking
 * cursor — and this comparison is what found it (method: arcreserve-6b).
 *
 * Emitters the indexer deliberately does not watch are excluded rather than reported: the Uniswap
 * pool factory (its PoolCreated is how the pool is born, not an asset event). Anything else
 * unwatched is REPORTED, because an unwatched ArcReserve contract is itself a finding.
 *
 * Read-only. Exits non-zero when anything is missing or unexpected, so it can gate a go-live.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
loadDotenv({ path: join(here, '..', '.env') });

const chainId = Number(process.argv[2]);
if (!Number.isInteger(chainId)) {
  console.error('usage: node scripts/verify-receipts.mjs <chainId>');
  process.exit(2);
}

const broadcastPath = join(repo, 'contracts', 'broadcast', 'DeployTestnet.s.sol', String(chainId), 'run-latest.json');
const deploymentPath = join(repo, 'contracts', 'deployments', `${chainId}.json`);
for (const path of [broadcastPath, deploymentPath]) {
  if (!existsSync(path)) {
    console.error(`missing ${path}`);
    process.exit(2);
  }
}

const toBig = (value) => BigInt(typeof value === 'string' ? value : `0x${Number(value).toString(16)}`);
const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
const broadcast = JSON.parse(readFileSync(broadcastPath, 'utf8'));
const deliberatelyUnwatched = new Set(
  [deployment.poolFactory].filter(Boolean).map((address) => address.toLowerCase()),
);

const receipts = broadcast.receipts ?? [];
const failed = receipts.filter((receipt) => toBig(receipt.status) !== 1n);
const emitted = receipts.flatMap((receipt) =>
  (receipt.logs ?? []).map((log) => ({
    block: toBig(log.blockNumber),
    logIndex: Number(toBig(log.logIndex)),
    address: log.address.toLowerCase(),
  })),
);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const cursorRow = await client.query(
    `SELECT block_number::text FROM indexer_cursors WHERE chain_id = $1 AND worker = 'arc-events'`,
    [chainId],
  );
  if (cursorRow.rowCount === 0) {
    console.error(`chain ${chainId}: no cursor — nothing indexed yet`);
    process.exit(1);
  }
  const cursor = BigInt(cursorRow.rows[0].block_number);

  const watchedRows = await client.query(
    'SELECT address, kind FROM watched_addresses WHERE chain_id = $1',
    [chainId],
  );
  const watched = new Map(watchedRows.rows.map((row) => [row.address.toLowerCase(), row.kind]));

  const storedRows = await client.query(
    'SELECT block_number::text, log_index, address FROM raw_logs WHERE chain_id = $1',
    [chainId],
  );
  const stored = new Set(storedRows.rows.map((row) => `${row.block_number}:${row.log_index}`));

  const inScope = emitted.filter((log) => log.block <= cursor);
  const missing = [];
  const unwatched = new Map();
  let excluded = 0;
  let expected = 0;

  for (const log of inScope) {
    if (deliberatelyUnwatched.has(log.address)) {
      excluded += 1;
      continue;
    }
    if (!watched.has(log.address)) {
      unwatched.set(log.address, (unwatched.get(log.address) ?? 0) + 1);
      continue;
    }
    expected += 1;
    if (!stored.has(`${log.block}:${log.logIndex}`)) missing.push(log);
  }

  const emittedKeys = new Set(emitted.map((log) => `${log.block}:${log.logIndex}`));
  const receiptRange = emitted.length === 0 ? null : [
    emitted.reduce((a, b) => (b.block < a ? b.block : a), emitted[0].block),
    emitted.reduce((a, b) => (b.block > a ? b.block : a), emitted[0].block),
  ];
  // Stored logs inside the deployment's block range that no receipt lists — would mean the
  // indexer invented or mis-attributed something.
  const unexpected = receiptRange === null ? [] : storedRows.rows.filter((row) => {
    const block = BigInt(row.block_number);
    return block >= receiptRange[0] && block <= receiptRange[1] && !emittedKeys.has(`${row.block_number}:${row.log_index}`);
  });

  console.log(`chain ${chainId}`);
  console.log(`  receipts ${receipts.length} (${failed.length} not status 1), logs emitted ${emitted.length}`);
  console.log(`  cursor ${cursor}; logs up to cursor ${inScope.length}`);
  console.log(`  deliberately unwatched (pool factory) ${excluded}`);
  console.log(`  expected in raw_logs ${expected}; missing ${missing.length}; unexpected ${unexpected.length}`);
  for (const [address, count] of unwatched) {
    console.log(`  NOT WATCHED: ${address} emitted ${count} log(s) — an ArcReserve contract the indexer never discovered?`);
  }
  if (missing.length > 0) {
    const byAddress = new Map();
    for (const log of missing) byAddress.set(log.address, (byAddress.get(log.address) ?? 0) + 1);
    for (const [address, count] of byAddress) {
      console.log(`  MISSING: ${count} log(s) from ${address} (${watched.get(address) ?? 'unwatched'})`);
    }
  }

  const clean = missing.length === 0 && unexpected.length === 0 && unwatched.size === 0 && failed.length === 0;
  console.log(clean ? '  RESULT: complete' : '  RESULT: INCOMPLETE');
  process.exitCode = clean ? 0 : 1;
} finally {
  await client.end();
}
