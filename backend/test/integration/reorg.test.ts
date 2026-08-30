import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress } from 'viem';
import { closeTestDatabase, testDatabase, truncateAll } from '../helpers/database.js';
import { testConfig } from '../helpers/chain.js';
import {
  ANVIL_ACCOUNTS,
  ANVIL_RPC_URL,
  blockNumber,
  mine,
  readLocalDeployment,
  requireAnvil,
  revertTo,

  sendTransaction,
  snapshot,
  type LocalDeployment,
} from '../helpers/anvil.js';
import { createChainClient } from '../../src/chain/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { Indexer } from '../../src/indexer/runner.js';
import { loadAbi } from '../../src/chain/abis.js';
import { findCommonAncestor } from '../../src/indexer/reorg.js';
import type { Database } from '../../src/db/client.js';
import type { Config } from '../../src/config.js';
import type { ArcPublicClient } from '../../src/chain/client.js';

/**
 * Reorg recovery against a real chain.
 *
 * Anvil's `evm_snapshot` / `evm_revert` rewinds history for real: every block above the
 * snapshot ceases to exist and the replacement blocks get different hashes. That is a
 * genuine reorg, not a simulated one, and it exercises the case that matters — a *projected*
 * purchase that has to be un-projected, not merely a deleted row.
 */

const logger = createLogger('silent', false);
const PURCHASE = 1_000_000_000n; // 1,000 mUSD at 6 decimals

let deployment: LocalDeployment;
let config: Config;
let client: ArcPublicClient;
let db: Database;
let indexer: Indexer;

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

  indexer = new Indexer({ config, db, client, logger });
  await indexer.prepare();
  await indexer.syncToHead();
});

afterAll(async () => {
  await closeTestDatabase();
});

interface ProjectionState {
  totalSupply: string;
  redemptionReserve: string;
  purchases: number;
  transfers: number;
  rawLogs: number;
  cursorBlock: bigint;
}

async function readProjectionState(): Promise<ProjectionState> {
  const supply = await db.one<{ total_supply: string }>(
    'SELECT total_supply::text FROM token_supply WHERE token = $1',
    [deployment.token.toLowerCase()],
  );
  const vault = await db.one<{ redemption_reserve: string }>(
    'SELECT redemption_reserve::text FROM vault_balances WHERE vault = $1',
    [deployment.vault.toLowerCase()],
  );
  const counts = await db.one<{ purchases: string; transfers: string; raw_logs: string }>(
    `SELECT (SELECT count(*) FROM offering_purchases)::text AS purchases,
            (SELECT count(*) FROM token_transfers)::text AS transfers,
            (SELECT count(*) FROM raw_logs)::text AS raw_logs`,
  );
  const cursor = await db.one<{ block_number: bigint }>(
    "SELECT block_number FROM indexer_cursors WHERE worker = 'arc-events'",
  );

  return {
    totalSupply: supply.total_supply,
    redemptionReserve: vault.redemption_reserve,
    purchases: Number(counts.purchases),
    transfers: Number(counts.transfers),
    rawLogs: Number(counts.raw_logs),
    cursorBlock: cursor.block_number,
  };
}

async function buyTokens(): Promise<void> {
  const buyer = ANVIL_ACCOUNTS.deployer;

  await sendTransaction(
    buyer,
    deployment.mockUSD,
    encodeFunctionData({
      abi: loadAbi('MockUSD'),
      functionName: 'faucet',
      args: [getAddress(buyer), PURCHASE],
    }),
  );

  await sendTransaction(
    buyer,
    deployment.mockUSD,
    encodeFunctionData({
      abi: loadAbi('MockUSD'),
      functionName: 'approve',
      args: [getAddress(deployment.offering), PURCHASE],
    }),
  );

  await sendTransaction(
    buyer,
    deployment.offering,
    encodeFunctionData({
      abi: loadAbi('PrimaryOffering'),
      functionName: 'buy',
      args: [PURCHASE, 0n],
    }),
  );
}

describe('reorg recovery', () => {
  it('rolls back a projected purchase when the chain that carried it is rewound', async () => {
    const before = await readProjectionState();
    const snapshotId = await snapshot();

    // Branch A: a real purchase. Mints tokens, splits mUSD into the vault, and writes a row
    // into three different projection tables.
    await buyTokens();
    await indexer.syncToHead();

    const withPurchase = await readProjectionState();
    expect(withPurchase.purchases).toBe(before.purchases + 1);
    expect(withPurchase.transfers).toBe(before.transfers + 1);
    expect(BigInt(withPurchase.totalSupply)).toBeGreaterThan(BigInt(before.totalSupply));
    expect(BigInt(withPurchase.redemptionReserve)).toBeGreaterThan(
      BigInt(before.redemptionReserve),
    );

    // Branch B: that history never happened.
    expect(await revertTo(snapshotId)).toBe(true);
    await mine(3);

    const summary = await indexer.syncToHead();

    expect(summary.reorgDepth).toBeGreaterThan(0);

    const after = await readProjectionState();

    // The incremental aggregates are the point. Deleting the orphaned blocks removes the
    // history rows by cascade, but supply and the vault categories carry no block key — they
    // are only correct because the read model is re-derived from the surviving logs.
    expect(after.totalSupply).toBe(before.totalSupply);
    expect(after.redemptionReserve).toBe(before.redemptionReserve);
    expect(after.purchases).toBe(before.purchases);
    expect(after.transfers).toBe(before.transfers);
    expect(after.rawLogs).toBe(before.rawLogs);
  });

  it('agrees with the chain after recovery', async () => {
    // The strongest statement available: whatever happened, the read model equals the
    // contracts' own view of themselves.
    const [totalSupply, redemptionReserve] = await Promise.all([
      client.readContract({
        address: getAddress(deployment.token),
        abi: loadAbi('AssetToken'),
        functionName: 'totalSupply',
      }) as Promise<bigint>,
      client.readContract({
        address: getAddress(deployment.vault),
        abi: loadAbi('AssetVault'),
        functionName: 'redemptionReserve',
      }) as Promise<bigint>,
    ]);

    const state = await readProjectionState();
    expect(state.totalSupply).toBe(totalSupply.toString());
    expect(state.redemptionReserve).toBe(redemptionReserve.toString());
  });

  it('re-indexes the replacement chain and converges again', async () => {
    const snapshotId = await snapshot();
    const before = await readProjectionState();

    await buyTokens();
    await indexer.syncToHead();
    const branchA = await readProjectionState();

    await revertTo(snapshotId);
    // The replacement branch carries the same purchase, so the read model must converge on
    // the same numbers by a different route rather than merely returning to the old ones.
    await buyTokens();
    await indexer.syncToHead();
    const branchB = await readProjectionState();

    expect(branchB.totalSupply).toBe(branchA.totalSupply);
    expect(branchB.redemptionReserve).toBe(branchA.redemptionReserve);
    expect(branchB.purchases).toBe(before.purchases + 1);

    const onChainSupply = (await client.readContract({
      address: getAddress(deployment.token),
      abi: loadAbi('AssetToken'),
      functionName: 'totalSupply',
    })) as bigint;
    expect(branchB.totalSupply).toBe(onChainSupply.toString());
  });

  it('finds the common ancestor rather than rewriting from genesis', async () => {
    const head = await blockNumber();
    const ancestor = await findCommonAncestor(db, client, config.CHAIN_ID, head);

    expect(ancestor).not.toBeNull();
    expect(ancestor).toBeLessThanOrEqual(head);
    // The whole point of walking back: recovery is bounded, not a full re-scan from zero.
    expect(ancestor).toBeGreaterThan(0n);
  });

  it('refuses to rewrite history when the divergence is deeper than the search window', async () => {
    // Diverge a block we have actually indexed, then search with a zero-depth window. The
    // guard being proved: an indexer that silently rewrites unbounded history is worse than
    // one that stops and says so.
    const snapshotId = await snapshot();
    await buyTokens();
    await indexer.syncToHead();

    const cursor = await db.one<{ block_number: bigint }>(
      "SELECT block_number FROM indexer_cursors WHERE worker = 'arc-events'",
    );

    await revertTo(snapshotId);
    await mine(2);

    const withoutWindow = await findCommonAncestor(
      db,
      client,
      config.CHAIN_ID,
      cursor.block_number,
      0,
    );
    expect(withoutWindow).toBeNull();

    // With a normal window the same divergence resolves to a real ancestor.
    const withWindow = await findCommonAncestor(
      db,
      client,
      config.CHAIN_ID,
      cursor.block_number,
      256,
    );
    expect(withWindow).not.toBeNull();
    expect(withWindow).toBeLessThan(cursor.block_number);

    await indexer.syncToHead();
  });
});
