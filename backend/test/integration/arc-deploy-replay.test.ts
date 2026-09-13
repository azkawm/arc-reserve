import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keccak256, toHex } from 'viem';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { testConfig } from '../helpers/chain.js';
import { createLogger } from '../../src/observability/logger.js';
import { Indexer } from '../../src/indexer/runner.js';
import { rebuildProjections } from '../../src/indexer/rebuild.js';
import type { ArcPublicClient } from '../../src/chain/client.js';
import type { Database } from '../../src/db/client.js';

/**
 * Arc's real deployment, replayed through the indexer with no network.
 *
 * On 2026-09-13 a clean sync of Arc — no failed pass, no rollback — still lost logs. Components
 * emit before the event that announces them, and at Arc's ~0.5 s blocks those pairs cross 100-block
 * range boundaries: compliance emitted both ModuleAdded logs one range before ComplianceAdded, and
 * the floor controller emitted three blocks before FloorControllerSet, across a boundary. Discovery
 * replayed only the current range, so compliance and the floor controller lost their earlier logs,
 * and the compliance modules — discoverable only through those logs — were never found.
 *
 * The local Anvil deployment cannot show this: it lands the whole asset system in one block, so no
 * range size splits a pair. These are the deployment's actual 118 logs (fixture provenance inside),
 * served by a stub that behaves like the chain: getLogs filters by address and range, and a contract
 * has code from the first block it emitted in (every component emits in its constructor).
 */

const logger = createLogger('silent', false);

interface FixtureLog {
  address: string;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
}

interface Fixture {
  chainId: number;
  startBlock: number;
  roots: { registry: string; factory: string; stablecoin: string };
  poolFactory: string;
  logs: FixtureLog[];
}

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'arc-deploy-logs.json'), 'utf8'),
) as Fixture;

const lastBlock = Math.max(...fixture.logs.map((log) => log.blockNumber));
const head = BigInt(lastBlock + 50);
const firstEmitted = new Map<string, number>();
for (const log of fixture.logs) {
  const seen = firstEmitted.get(log.address);
  if (seen === undefined || log.blockNumber < seen) firstEmitted.set(log.address, log.blockNumber);
}
const timestampOf = (block: number): bigint => {
  const exact = fixture.logs.find((log) => log.blockNumber === block);
  if (exact !== undefined) return BigInt(exact.blockTimestamp);
  const base = fixture.logs[0]!;
  return BigInt(base.blockTimestamp + Math.floor((block - base.blockNumber) / 2));
};
const hashOf = (block: bigint): `0x${string}` => keccak256(toHex(`arc-block-${block}`));

/** A chain that answers exactly as Arc did for this deployment. */
function arcClient(options: { ignoresBlockNumber?: boolean; failsDeepHistory?: boolean } = {}): ArcPublicClient {
  const stub = {
    chain: { id: fixture.chainId },
    async getChainId() {
      return fixture.chainId;
    },
    async getBlockNumber() {
      return head;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return {
        number: blockNumber,
        hash: hashOf(blockNumber),
        parentHash: hashOf(blockNumber - 1n),
        timestamp: timestampOf(Number(blockNumber)),
      };
    },
    async getCode({ address, blockNumber }: { address: string; blockNumber?: bigint }) {
      // A load-balanced relay whose history probe passes (head, and the block before START) but whose
      // deeper historical reads land on backends that do not have them, every time.
      if (
        options.failsDeepHistory &&
        blockNumber !== undefined &&
        blockNumber !== BigInt(fixture.startBlock - 1)
      ) {
        throw new Error('injected: this backend does not serve history that deep');
      }
      const created = firstEmitted.get(address.toLowerCase());
      if (created === undefined) return '0x';
      // A relay that ignores the block parameter answers with current state at every height.
      if (!options.ignoresBlockNumber && blockNumber !== undefined && blockNumber < BigInt(created)) return '0x';
      return '0x60806040';
    },
    async getLogs({ address, fromBlock, toBlock }: { address: string[]; fromBlock: bigint; toBlock: bigint }) {
      const wanted = new Set(address.map((a) => a.toLowerCase()));
      return fixture.logs
        .filter(
          (log) =>
            wanted.has(log.address) &&
            BigInt(log.blockNumber) >= fromBlock &&
            BigInt(log.blockNumber) <= toBlock,
        )
        .map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: BigInt(log.blockNumber),
          blockHash: hashOf(BigInt(log.blockNumber)),
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
          removed: false,
        }));
    },
  };
  return stub as unknown as ArcPublicClient;
}

let db: Database;

beforeAll(async () => {
  db = await testDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function replay(
  maxBlockRange: number,
  clientOptions: { ignoresBlockNumber?: boolean; failsDeepHistory?: boolean } = {},
  attempts = 1,
) {
  const config = testConfig({
    CHAIN_ID: String(fixture.chainId),
    RPC_HTTP_URL: 'http://arc.test',
    START_BLOCK: String(fixture.startBlock),
    MAX_BLOCK_RANGE: String(maxBlockRange),
    CONFIRMATIONS: '0',
    REGISTRY_ADDRESS: fixture.roots.registry,
    FACTORY_ADDRESS: fixture.roots.factory,
    MUSD_ADDRESS: fixture.roots.stablecoin,
    COMPANY_VESTING_ADDRESS: '',
  });

  await truncateAll(db);
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'Arc Testnet', 2, $2, $3, $4, $5)`,
    [fixture.chainId, fixture.roots.registry, fixture.roots.factory, fixture.roots.stablecoin, fixture.startBlock],
  );

  const indexer = new Indexer({ config, db, client: arcClient(clientOptions), logger });
  await indexer.prepare();
  // Each attempt is one poll of the running loop: a failed pass leaves the range unfinished to retry.
  let attemptsUsed = 0;
  for (;;) {
    attemptsUsed += 1;
    try {
      await indexer.syncToHead();
      break;
    } catch (error) {
      if (attemptsUsed >= attempts) throw error;
    }
  }

  const stored = await db.query<{ block_number: string; log_index: number }>(
    'SELECT block_number::text, log_index FROM raw_logs WHERE chain_id = $1',
    [fixture.chainId],
  );
  const kinds = await db.query<{ kind: string }>(
    'SELECT DISTINCT kind FROM watched_addresses WHERE chain_id = $1 ORDER BY kind',
    [fixture.chainId],
  );
  return {
    stored: new Set(stored.rows.map((row) => `${row.block_number}:${row.log_index}`)),
    kinds: kinds.rows.map((row) => row.kind),
    attemptsUsed,
    config,
  };
}

async function owedBackfills(): Promise<number> {
  const row = await db.one<{ n: string }>(
    'SELECT count(*)::text AS n FROM watched_addresses WHERE chain_id = $1 AND NOT backfilled',
    [fixture.chainId],
  );
  return Number(row.n);
}

// Every log the deployment emitted from a contract the indexer should watch: all but the Uniswap
// pool factory, whose PoolCreated is how the pool is born rather than an asset event.
const expected = new Set(
  fixture.logs
    .filter((log) => log.address !== fixture.poolFactory)
    .map((log) => `${log.blockNumber}:${log.logIndex}`),
);

describe("Arc's real deployment", () => {
  it('stores every log and discovers every contract at the production range of 100 blocks', async () => {
    const { stored, kinds } = await replay(100);

    const missing = [...expected].filter((key) => !stored.has(key));
    expect(missing, 'deployment logs missing from raw_logs').toEqual([]);
    expect([...stored].filter((key) => !expected.has(key)), 'logs stored that no receipt lists').toEqual([]);

    // The three contracts the defect lost, by name.
    for (const kind of ['compliance', 'complianceModule', 'floorController', 'identityRegistry']) {
      expect(kinds, `discovered ${kind}`).toContain(kind);
    }
  });

  it('stays complete behind a relay that ignores the block number on eth_getCode', async () => {
    // The quiet failure: such a relay says "code present" at every height, so a creation-block search
    // would land on START_BLOCK every time. The two-sided probe detects it and backfills from
    // START_BLOCK knowingly — more getLogs, never fewer logs.
    const { stored, kinds } = await replay(100, { ignoresBlockNumber: true });
    expect([...expected].filter((key) => !stored.has(key)), 'missing behind a block-ignoring relay').toEqual([]);
    for (const kind of ['compliance', 'complianceModule', 'floorController']) {
      expect(kinds, `discovered ${kind} behind a block-ignoring relay`).toContain(kind);
    }
  });

  it('does not stall forever behind a relay whose deep history keeps failing', async () => {
    // Retrying a transient failure is right; retrying a persistent one freezes the chain. The first
    // polls must fail (proving the retry path ran), and a bounded number later the range must complete.
    const { stored, kinds, attemptsUsed } = await replay(100, { failsDeepHistory: true }, 10);

    expect(attemptsUsed, 'polls before converging').toBeGreaterThan(1);
    expect(attemptsUsed, 'polls before converging').toBeLessThanOrEqual(4);
    expect([...expected].filter((key) => !stored.has(key)), 'missing behind a failing-history relay').toEqual([]);
    for (const kind of ['compliance', 'complianceModule', 'floorController']) {
      expect(kinds, `discovered ${kind} behind a failing-history relay`).toContain(kind);
    }
    // Before the obligation was durable, the failed first attempt had already persisted these
    // components, the retry saw nothing new, and the range converged twelve logs short.
    expect(await owedBackfills(), 'backfills still owed after converging').toBe(0);
  });

  it('treats a watched row written without the backfill flag as owing one', async () => {
    // Only rows that existed at migration time were verified complete. Any later writer that omits
    // the column (an older process, a fixture, a manual repair) must fail toward a redundant backfill.
    await truncateAll(db);
    await db.query(
      `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                           factory_address, stablecoin_address, start_block)
       VALUES ($1, 'Arc Testnet', 2, $2, $3, $4, $5)`,
      [fixture.chainId, fixture.roots.registry, fixture.roots.factory, fixture.roots.stablecoin, fixture.startBlock],
    );
    await db.query(
      `INSERT INTO watched_addresses (chain_id, address, kind, discovered_at_block)
       VALUES ($1, '0x00000000000000000000000000000000000000c1', 'compliance', 42)`,
      [fixture.chainId],
    );
    expect(await owedBackfills(), 'a row inserted without the flag').toBe(1);
  });

  it('keeps settled backfills settled through a rebuild', async () => {
    // A rebuild replays logs already fetched, so it cannot un-fetch a backfill. Rediscovered
    // components that came back owing one would re-fetch their whole history on the next range.
    const { config } = await replay(100);
    expect(await owedBackfills(), 'owed after the sync').toBe(0);

    await rebuildProjections(db, config, logger);

    expect(await owedBackfills(), 'owed after the rebuild').toBe(0);
    const kinds = await db.query<{ kind: string }>(
      'SELECT DISTINCT kind FROM watched_addresses WHERE chain_id = $1',
      [fixture.chainId],
    );
    for (const kind of ['compliance', 'complianceModule', 'floorController', 'identityRegistry']) {
      expect(kinds.rows.map((row) => row.kind), `rebuild rediscovered ${kind}`).toContain(kind);
    }
  });

  it('converges on the same logs whatever range size cuts the deployment', async () => {
    // 1 and 7 split every pair; 1000 holds the whole deployment in one range and is the easy case.
    for (const range of [1, 7, 1000]) {
      const { stored } = await replay(range);
      const missing = [...expected].filter((key) => !stored.has(key));
      expect(missing, `missing with MAX_BLOCK_RANGE=${range}`).toEqual([]);
      expect(stored.size, `stored with MAX_BLOCK_RANGE=${range}`).toBe(expected.size);
    }
  });
});
