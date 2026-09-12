import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { testConfig } from '../helpers/chain.js';
import {
  ANVIL_RPC_URL,
  readLocalDeployment,
  requireAnvil,
  type LocalDeployment,
} from '../helpers/anvil.js';
import { createChainClient, type ArcPublicClient } from '../../src/chain/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { Indexer } from '../../src/indexer/runner.js';
import type { Database } from '../../src/db/client.js';
import type { Config } from '../../src/config.js';

/**
 * A range's cursor may only move once its discovery loop has converged.
 *
 * On Arc (2026-09-13) a block fetch failed during a replay pass — a pass that fetches the logs
 * newly discovered components emitted earlier in the range. The first pass had already committed
 * the cursor across the whole range, block by block, so the next run began after it: 17
 * deployment logs were skipped for good, and compliance plus both modules were never discovered.
 * Nothing looked wrong; the cursor sat exactly where a healthy sync would leave it.
 *
 * The local DeployLocal chain has the same cascade — roots, then the asset system, then the token's
 * identity registry and compliance, then compliance's modules — so a clean sync is an exact oracle,
 * and a replay pass at ANY depth of that cascade can be made to fail on demand.
 */

const logger = createLogger('silent', false);

let deployment: LocalDeployment;
let config: Config;
let db: Database;
let real: ArcPublicClient;

interface ReadModel {
  rawLogs: number;
  watched: string[];
}

async function readModel(): Promise<ReadModel> {
  const logs = await db.one<{ n: string }>('SELECT count(*)::text AS n FROM raw_logs');
  const kinds = await db.query<{ kind: string; address: string }>(
    'SELECT kind, address FROM watched_addresses ORDER BY kind, address',
  );
  return {
    rawLogs: Number(logs.n),
    watched: kinds.rows.map((row) => `${row.kind}:${row.address}`),
  };
}

async function freshChain(): Promise<void> {
  await truncateAll(db);
  await db.query(
    `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                         factory_address, stablecoin_address, start_block)
     VALUES ($1, 'Anvil', 0, $2, $3, $4, 0)`,
    [
      config.CHAIN_ID,
      config.addresses.registry,
      config.addresses.factory,
      config.addresses.stablecoin,
    ],
  );
}

/**
 * The real client, instrumented. getLogs is called exactly once per discovery pass, so its call
 * count is the pass number. When `failOnPass` is set, the first block fetch made during that pass
 * throws once — after earlier passes have already ingested and discovered.
 */
function instrumented(failOnPass: number | null): {
  client: ArcPublicClient;
  passes: () => number;
  fired: () => boolean;
} {
  let getLogsCalls = 0;
  let fired = false;
  const client = new Proxy(real, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === 'getLogs') {
        return async (...args: unknown[]) => {
          getLogsCalls += 1;
          return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === 'getBlock') {
        return async (...args: unknown[]) => {
          if (failOnPass !== null && getLogsCalls === failOnPass && !fired) {
            fired = true;
            throw new Error(`injected: block fetch failed during discovery pass ${failOnPass}`);
          }
          return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return value;
    },
  });
  return { client, passes: () => getLogsCalls, fired: () => fired };
}

beforeAll(async () => {
  deployment = readLocalDeployment();
  await requireAnvil(deployment);
  config = testConfig({
    RPC_HTTP_URL: ANVIL_RPC_URL,
    REGISTRY_ADDRESS: deployment.registry,
    FACTORY_ADDRESS: deployment.factory,
    MUSD_ADDRESS: deployment.mockUSD,
    COMPANY_VESTING_ADDRESS: '',
  });
  real = createChainClient(config);
  db = await testDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('a range whose discovery replay fails', () => {
  it('never moves the cursor past an unconverged range, at any depth of the real cascade', async () => {
    const head = await real.getBlockNumber();

    // Oracle, and a measurement: a clean sync stores and discovers everything, and the number of
    // passes it needs is the real depth of this deployment's discovery cascade.
    await freshChain();
    const cleanClient = instrumented(null);
    const clean = new Indexer({ config, db, client: cleanClient.client, logger });
    await clean.prepare();
    await clean.syncToHead();
    const expected = await readModel();
    const depth = cleanClient.passes();

    // The oracle must exercise the full cascade, or the loop below proves less than it claims.
    for (const kind of ['token:', 'identityRegistry:', 'compliance:', 'complianceModule:']) {
      expect(expected.watched.some((entry) => entry.startsWith(kind)), kind).toBe(true);
    }
    // Discovery genuinely takes several passes here: roots, components, compliance, modules, and
    // one more to observe that nothing grew. Recorded so the margin to the bound is visible.
    expect(depth).toBeGreaterThanOrEqual(3);
    expect(depth).toBeLessThan(16);

    // Every replay pass — every level of the cascade — failing once in turn.
    for (let failOnPass = 2; failOnPass <= depth; failOnPass += 1) {
      await freshChain();
      const flaky = instrumented(failOnPass);
      const interrupted = new Indexer({ config, db, client: flaky.client, logger });
      await interrupted.prepare();
      await expect(interrupted.syncToHead(), `pass ${failOnPass}`).rejects.toThrow(/injected/);
      expect(flaky.fired(), `pass ${failOnPass} fired`).toBe(true);

      // The defect: the cursor sat on the head over a read model missing later-discovered logs.
      const cursor = await db.maybe<{ block_number: string }>(
        "SELECT block_number::text FROM indexer_cursors WHERE worker = 'arc-events'",
      );
      expect(
        cursor === null || BigInt(cursor.block_number) < head,
        `cursor advanced over an unconverged range when pass ${failOnPass} failed`,
      ).toBe(true);

      // A healthy retry re-runs the same range and converges on exactly the oracle.
      const retry = new Indexer({ config, db, client: real, logger });
      await retry.prepare();
      await retry.syncToHead();
      const recovered = await readModel();
      expect(recovered.rawLogs, `raw logs after retrying pass ${failOnPass}`).toBe(expected.rawLogs);
      expect(recovered.watched, `watched set after retrying pass ${failOnPass}`).toEqual(expected.watched);
    }
  });
});
