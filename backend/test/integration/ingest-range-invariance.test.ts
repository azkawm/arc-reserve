import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { testConfig } from '../helpers/chain.js';
import {
  ANVIL_RPC_URL,
  readLocalDeployment,
  requireAnvil,
  type LocalDeployment,
} from '../helpers/anvil.js';
import { createChainClient } from '../../src/chain/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { Indexer } from '../../src/indexer/runner.js';
import type { Database } from '../../src/db/client.js';
import type { Config } from '../../src/config.js';

/**
 * What the indexer stores must not depend on how the chain is cut into ranges.
 *
 * On Arc (2026-09-13), a clean sync with no failures still lost logs. Components emit BEFORE the
 * event that announces them, and on a fast chain the two can land in different block ranges:
 * compliance emitted both ModuleAdded logs in one 100-block range and was announced in the next;
 * the floor controller emitted three blocks before FloorControllerSet, across a boundary. Discovery
 * replayed only the current range, so a component's logs from an earlier range were never fetched —
 * and the compliance modules, discoverable only through those logs, were never found at all.
 *
 * The oracle is one range over the whole local deployment, and the same chain synced with tiny ranges
 * must converge on exactly the same logs, discovered contracts and projections.
 *
 * WHAT THIS DOES NOT PROVE: the local deployment lands the whole asset system in ONE block, so no range
 * size can split an emit-before-announce pair here, and this test passed even before the Arc fix. It
 * guards range cutting in general. The cross-boundary case is covered by arc-deploy-replay.test.ts,
 * which replays Arc's real deployment and fails without the fix. Do not count this one as evidence.
 */

const logger = createLogger('silent', false);

let deployment: LocalDeployment;
let baseEnv: Record<string, string>;
let db: Database;

interface ReadModel {
  rawLogs: number;
  watched: string[];
  modules: string;
  identities: number;
  totalAccounted: string;
}

async function readModel(): Promise<ReadModel> {
  const logs = await db.one<{ n: string }>('SELECT count(*)::text AS n FROM raw_logs');
  const watched = await db.query<{ kind: string; address: string }>(
    'SELECT kind, address FROM watched_addresses ORDER BY kind, address',
  );
  const modules = await db.maybe<{ modules: string }>(
    "SELECT coalesce(string_agg(m, ',' ORDER BY m), '') AS modules FROM compliance_config, jsonb_array_elements_text(modules) m",
  );
  const identities = await db.one<{ n: string }>('SELECT count(*)::text AS n FROM identities');
  const vault = await db.maybe<{ total: string }>(
    'SELECT coalesce(sum(total_accounted), 0)::text AS total FROM vault_balances',
  );
  return {
    rawLogs: Number(logs.n),
    watched: watched.rows.map((row) => `${row.kind}:${row.address}`),
    modules: modules?.modules ?? '',
    identities: Number(identities.n),
    totalAccounted: vault?.total ?? '0',
  };
}

async function syncWithRange(maxBlockRange: string): Promise<ReadModel> {
  const config: Config = testConfig({ ...baseEnv, MAX_BLOCK_RANGE: maxBlockRange });
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
  const indexer = new Indexer({ config, db, client: createChainClient(config), logger });
  await indexer.prepare();
  await indexer.syncToHead();
  return readModel();
}

beforeAll(async () => {
  deployment = readLocalDeployment();
  await requireAnvil(deployment);
  baseEnv = {
    RPC_HTTP_URL: ANVIL_RPC_URL,
    REGISTRY_ADDRESS: deployment.registry,
    FACTORY_ADDRESS: deployment.factory,
    MUSD_ADDRESS: deployment.mockUSD,
    COMPANY_VESTING_ADDRESS: '',
  };
  db = await testDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('range-size invariance', () => {
  it('stores the same logs, contracts and projections however the chain is cut into ranges', async () => {
    const oracle = await syncWithRange('2000');

    // The oracle must itself contain the late-announced components, or invariance proves little.
    for (const kind of ['identityRegistry:', 'compliance:', 'complianceModule:', 'floorController:']) {
      expect(oracle.watched.some((entry) => entry.startsWith(kind)), `oracle discovered ${kind}`).toBe(true);
    }
    expect(oracle.modules, 'oracle projected compliance modules').not.toBe('');

    for (const range of ['1', '2', '5', '13']) {
      const cut = await syncWithRange(range);
      expect(cut.rawLogs, `raw logs with MAX_BLOCK_RANGE=${range}`).toBe(oracle.rawLogs);
      expect(cut.watched, `discovered contracts with MAX_BLOCK_RANGE=${range}`).toEqual(oracle.watched);
      expect(cut.modules, `compliance modules with MAX_BLOCK_RANGE=${range}`).toBe(oracle.modules);
      expect(cut.identities, `identities with MAX_BLOCK_RANGE=${range}`).toBe(oracle.identities);
      expect(cut.totalAccounted, `vault accounting with MAX_BLOCK_RANGE=${range}`).toBe(oracle.totalAccounted);
    }
  });
});
