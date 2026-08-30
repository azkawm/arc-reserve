import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
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
import { loadAbi } from '../../src/chain/abis.js';
import type { Database } from '../../src/db/client.js';
import type { Config } from '../../src/config.js';
import type { ArcPublicClient } from '../../src/chain/client.js';

/**
 * Milestone B acceptance.
 *
 * "A fresh database replaying a seeded DeployLocal chain yields exactly the state the
 * contracts hold." The assertions deliberately compare against the contracts' **own view
 * functions at the indexed block**, not against constants copied out of a document. A
 * hardcoded expectation would have gone stale twice already this week: D-024 changed the
 * denominators and D-031 removed the company vesting allocation, and section 7 of
 * CONTRACTS_TO_BACKEND still describes the old seed.
 */

const logger = createLogger('silent', false);

let deployment: LocalDeployment;
let config: Config;
let client: ArcPublicClient;
let db: Database;

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

  client = createChainClient(config);
  db = await testDatabase();
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

  const indexer = new Indexer({ config, db, client, logger });
  await indexer.prepare();
  await indexer.syncToHead();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function readView<T>(
  address: string,
  abiName: Parameters<typeof loadAbi>[0],
  functionName: string,
  args: unknown[] = [],
): Promise<T> {
  return client.readContract({
    address: getAddress(address),
    abi: loadAbi(abiName),
    functionName,
    args,
  }) as Promise<T>;
}

describe('replaying a seeded DeployLocal chain', () => {
  it('discovers every component address from events, not from configuration', async () => {
    const { rows } = await db.query<{ address: string; kind: string }>(
      'SELECT address, kind FROM watched_addresses ORDER BY kind',
    );
    const byKind = new Map(rows.map((row) => [row.kind, row.address]));

    // Only three were configured; the rest came out of AssetSystemDeployed and the token's
    // own IdentityRegistryAdded / ComplianceAdded announcements.
    expect(byKind.get('token')).toBe(deployment.token.toLowerCase());
    expect(byKind.get('vault')).toBe(deployment.vault.toLowerCase());
    expect(byKind.get('offering')).toBe(deployment.offering.toLowerCase());
    expect(byKind.get('marketManager')).toBe(deployment.marketManager.toLowerCase());
    expect(byKind.get('revenueDistributor')).toBe(deployment.revenueDistributor.toLowerCase());
    expect(byKind.get('redemptionController')).toBe(deployment.redemptionController.toLowerCase());
    expect(byKind.get('pool')).toBe(deployment.pool.toLowerCase());
    expect(byKind.get('identityRegistry')).toBe(deployment.identityRegistry.toLowerCase());
    expect(byKind.get('compliance')).toBe(deployment.compliance.toLowerCase());
  });

  it('reproduces the asset identity, status and NAV the registry holds', async () => {
    const row = await db.one<{
      asset_id: string;
      issuer: string;
      status: number;
      current_nav: string;
      nav_updated_at: bigint;
      category: string;
      maturity_timestamp: bigint;
    }>(
      `SELECT asset_id, issuer, status, current_nav::text, nav_updated_at, category,
              maturity_timestamp
         FROM assets`,
    );

    const [status, navResult, issuer, maturity] = await Promise.all([
      readView<number>(deployment.registry, 'AssetRegistry', 'statusOf', [deployment.assetId]),
      // navOf returns (nav, timestamp) — the pair D-009 insists on keeping together, since a
      // NAV without its age is not a usable number.
      readView<readonly [bigint, bigint]>(deployment.registry, 'AssetRegistry', 'navOf', [
        deployment.assetId,
      ]),
      readView<string>(deployment.registry, 'AssetRegistry', 'issuerOf', [deployment.assetId]),
      readView<bigint>(deployment.registry, 'AssetRegistry', 'maturityOf', [deployment.assetId]),
    ]);

    expect(row.asset_id).toBe(deployment.assetId.toLowerCase());
    expect(row.status).toBe(Number(status));
    expect(row.current_nav).toBe(navResult[0].toString());
    expect(row.nav_updated_at).toBe(navResult[1]);
    expect(row.issuer).toBe(issuer.toLowerCase());
    expect(row.maturity_timestamp).toBe(maturity);
  });

  it('reproduces all three supply denominators', async () => {
    const row = await db.one<{
      total_supply: string;
      excluded_supply: string;
      issuer_allocation_supply: string;
    }>(
      `SELECT total_supply::text, excluded_supply::text, issuer_allocation_supply::text
         FROM token_supply WHERE token = $1`,
      [deployment.token.toLowerCase()],
    );

    const [totalSupply, issuerAllocationSupply, investorSupply, excludedSupply] = await Promise.all([
      readView<bigint>(deployment.token, 'AssetToken', 'totalSupply'),
      readView<bigint>(deployment.token, 'AssetToken', 'issuerAllocationSupply'),
      readView<bigint>(deployment.token, 'AssetToken', 'investorSupply'),
      readView<bigint>(deployment.revenueDistributor, 'RevenueDistributor', 'excludedSupply'),
    ]);

    expect(row.total_supply).toBe(totalSupply.toString());
    expect(row.issuer_allocation_supply).toBe(issuerAllocationSupply.toString());
    expect(row.excluded_supply).toBe(excludedSupply.toString());

    // The derived denominator the API will serve, checked against the contract's own view.
    const derivedInvestorSupply = BigInt(row.total_supply) - BigInt(row.issuer_allocation_supply);
    expect(derivedInvestorSupply).toBe(investorSupply);
  });

  it('reproduces all five vault categories and the accounted total', async () => {
    const row = await db.one<Record<string, string>>(
      `SELECT redemption_reserve::text, market_making_allocation::text, asset_revenue::text,
              issuer_proceeds::text, protocol_fees::text, total_accounted::text
         FROM vault_balances WHERE vault = $1`,
      [deployment.vault.toLowerCase()],
    );

    const views = await Promise.all(
      (
        [
          ['redemption_reserve', 'redemptionReserve'],
          ['market_making_allocation', 'marketMakingAllocation'],
          ['asset_revenue', 'assetRevenue'],
          ['issuer_proceeds', 'issuerProceeds'],
          ['protocol_fees', 'protocolFees'],
          ['total_accounted', 'totalAccounted'],
        ] as const
      ).map(async ([column, view]) => {
        const value = await readView<bigint>(deployment.vault, 'AssetVault', view);
        return [column, value.toString()] as const;
      }),
    );

    for (const [column, expected] of views) {
      expect(`${column}=${row[column]}`).toBe(`${column}=${expected}`);
    }

    // The identity the vault itself enforces must survive the projection.
    const sum =
      BigInt(row.redemption_reserve ?? '0') +
      BigInt(row.market_making_allocation ?? '0') +
      BigInt(row.asset_revenue ?? '0') +
      BigInt(row.issuer_proceeds ?? '0') +
      BigInt(row.protocol_fees ?? '0');
    expect(sum.toString()).toBe(row.total_accounted);
  });

  it('reproduces the D-023 reserve schedule as configuration, not as a stale snapshot', async () => {
    const row = await db.maybe<{
      start_backing: string;
      target_backing: string;
      start_time: bigint;
      maturity: bigint;
      grace_seconds: bigint;
    }>(
      `SELECT start_backing::text, target_backing::text, start_time, maturity, grace_seconds
         FROM reserve_schedules WHERE vault = $1`,
      [deployment.vault.toLowerCase()],
    );

    const schedule = await readView<readonly [bigint, bigint, bigint, bigint, bigint]>(
      deployment.vault,
      'AssetVault',
      'reserveSchedule',
    );

    // The vault only has a schedule if DeployLocal set one; when it did, ours must match.
    if (row === null) {
      expect(schedule[1]).toBe(0n);
      return;
    }

    expect(row.start_backing).toBe(schedule[0].toString());
    expect(row.target_backing).toBe(schedule[1].toString());
    expect(row.start_time).toBe(schedule[2]);
    expect(row.maturity).toBe(schedule[3]);
    expect(row.grace_seconds).toBe(schedule[4]);
  });

  it('reproduces the identity registry without storing the time-dependent verification', async () => {
    const { rows } = await db.query<{
      investor: string;
      country: number;
      investor_class: number;
      claim_expires_at: bigint | null;
      registered: boolean;
    }>('SELECT investor, country, investor_class, claim_expires_at, registered FROM identities ORDER BY investor');

    expect(rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows) {
      const onChain = await readView<boolean>(
        deployment.identityRegistry,
        'IdentityRegistry',
        'isVerified',
        [getAddress(row.investor)],
      );
      // isVerified is computed, never stored. Recomputing it from what we did store must
      // agree with the contract right now.
      const now = BigInt(Math.floor(Date.now() / 1000));
      const expiry = row.claim_expires_at;
      const derived = row.registered && (expiry === null || expiry === 0n || expiry > now);
      expect(derived).toBe(onChain);
    }

    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'identities'`,
    );
    expect(columns.rows.map((c) => c.column_name)).not.toContain('is_verified');
  });

  it('records the configured market positions with liquidity as a raw uint128', async () => {
    const { rows } = await db.query<{ kind: number; tick_lower: number; tick_upper: number; liquidity: string }>(
      `SELECT kind, tick_lower, tick_upper, liquidity::text FROM position_configs
        WHERE market_manager = $1 ORDER BY kind`,
      [deployment.marketManager.toLowerCase()],
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const position = await readView<readonly [number, number, bigint, boolean]>(
        deployment.marketManager,
        'AssetMarketManager',
        'positions',
        [row.kind],
      );
      expect(row.tick_lower).toBe(position[0]);
      expect(row.tick_upper).toBe(position[1]);
      expect(row.liquidity).toBe(position[2].toString());
    }
  });

  it('flags no projection anomalies', async () => {
    const { rows } = await db.query<{ kind: string; detail: unknown }>(
      'SELECT kind, detail FROM projection_anomalies WHERE resolved = FALSE',
    );
    expect(rows).toEqual([]);
  });

  it('keeps every log it could not decode instead of dropping it', async () => {
    const { rows } = await db.query<{ count: string; decoded: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE event_name IS NOT NULL)::text AS decoded
         FROM raw_logs`,
    );
    const total = Number(rows[0]?.count ?? '0');
    const decoded = Number(rows[0]?.decoded ?? '0');

    expect(total).toBeGreaterThan(0);
    // Everything from a watched ArcReserve address should decode against the committed ABIs.
    expect(decoded).toBe(total);
  });
});

describe('restart and idempotency', () => {
  it('resumes from the cursor and ingests nothing twice', async () => {
    const before = await snapshotCounts();

    // A brand new Indexer instance: nothing carried over in memory, everything reloaded
    // from the database — the restart path.
    const restarted = new Indexer({ config, db, client, logger });
    await restarted.prepare();
    const summary = await restarted.syncToHead();

    expect(summary.blocksIngested).toBe(0);
    expect(summary.logsStored).toBe(0);
    expect(summary.reorgDepth).toBe(0);
    expect(await snapshotCounts()).toEqual(before);
  });

  it('produces the same state when the whole chain is replayed into a fresh database', async () => {
    const before = await snapshotCounts();
    const beforeSupply = await db.one<{ total_supply: string }>(
      'SELECT total_supply::text FROM token_supply',
    );

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

    const fresh = new Indexer({ config, db, client, logger });
    await fresh.prepare();
    await fresh.syncToHead();

    expect(await snapshotCounts()).toEqual(before);
    const afterSupply = await db.one<{ total_supply: string }>(
      'SELECT total_supply::text FROM token_supply',
    );
    expect(afterSupply.total_supply).toBe(beforeSupply.total_supply);
  });
});

async function snapshotCounts(): Promise<Record<string, number>> {
  const tables = [
    'raw_logs',
    'assets',
    'asset_deployments',
    'nav_history',
    'asset_status_history',
    'token_transfers',
    'token_balances',
    'vault_allocations',
    'identities',
    'position_configs',
    'position_liquidity_events',
    'projection_anomalies',
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
    counts[table] = Number(row.count);
  }
  return counts;
}

describe('components discovered outside AssetSystemDeployed', () => {
  it('finds the floor controller through FloorControllerSet', async () => {
    // The controller is not part of the factory's deployment tuple, so without following the
    // manager's own announcement its FloorLevelUp events would never be seen at all.
    const row = await db.maybe<{ address: string }>(
      "SELECT address FROM watched_addresses WHERE kind = 'floorController'",
    );
    expect(row?.address).toBe(deployment.floorController?.toLowerCase());

    const link = await db.one<{ floor_controller: string | null }>(
      'SELECT floor_controller FROM asset_deployments',
    );
    expect(link.floor_controller).toBe(deployment.floorController?.toLowerCase());
  });

  it('records the term-sheet hash from TermsApproved', async () => {
    const row = await db.one<{ terms_hash: string | null }>('SELECT terms_hash FROM assets');
    const onChain = await readView<string>(
      deployment.registry,
      'AssetRegistry',
      'termsHashOf',
      [deployment.assetId],
    );
    expect(row.terms_hash).toBe(onChain.toLowerCase());
  });
});
