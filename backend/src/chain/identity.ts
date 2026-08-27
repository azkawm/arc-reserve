import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { ArcPublicClient } from './client.js';
import { StartupError } from '../lib/errors.js';

/**
 * Startup guards.
 *
 * The failure this file exists to prevent: a developer restarts Anvil, every address
 * changes, and the indexer happily continues against a database describing a chain that no
 * longer exists. The result is a read model that looks healthy and is entirely fictional.
 * So the process verifies, in order: the RPC really is the configured chain; the configured
 * addresses really have code; the database is not holding a different deployment; and the
 * cursor block hash still matches the chain.
 */

export type CursorState =
  | { kind: 'no-cursor' }
  | { kind: 'ok'; worker: string; blockNumber: bigint; blockHash: string }
  | { kind: 'reorg'; worker: string; blockNumber: bigint; storedHash: string; rpcHash: string | null }
  | { kind: 'restarted'; worker: string; blockNumber: bigint; storedHash: string };

export interface ChainStateReport {
  configuredChainId: number;
  rpcChainId: number;
  latestBlock: bigint;
  contractsPresent: { registry: boolean; factory: boolean; stablecoin: boolean };
  cursorState: CursorState;
}

interface CursorRow {
  worker: string;
  block_number: bigint;
  block_hash: string;
}

export async function verifyChainIdentity(
  client: ArcPublicClient,
  config: Config,
): Promise<number> {
  let rpcChainId: number;
  try {
    rpcChainId = await client.getChainId();
  } catch (error) {
    throw new StartupError(
      `cannot reach RPC at ${config.RPC_HTTP_URL}: ${(error as Error).message}`,
      config.CHAIN_ID === 31337 ? 'is anvil running?' : 'check RPC_HTTP_URL and network access',
    );
  }
  if (rpcChainId !== config.CHAIN_ID) {
    throw new StartupError(
      `chain mismatch: CHAIN_ID=${config.CHAIN_ID} but ${config.RPC_HTTP_URL} reports ${rpcChainId}`,
      'point RPC_HTTP_URL at the configured chain, or fix CHAIN_ID',
    );
  }
  return rpcChainId;
}

export async function verifyDeploymentPresent(
  client: ArcPublicClient,
  config: Config,
): Promise<ChainStateReport['contractsPresent']> {
  const [registry, factory, stablecoin] = await Promise.all([
    hasCode(client, config.addresses.registry),
    hasCode(client, config.addresses.factory),
    hasCode(client, config.addresses.stablecoin),
  ]);

  const missing = [
    ...(registry ? [] : ['REGISTRY_ADDRESS']),
    ...(factory ? [] : ['FACTORY_ADDRESS']),
    ...(stablecoin ? [] : ['MUSD_ADDRESS']),
  ];

  if (missing.length > 0) {
    throw new StartupError(
      `no contract code at ${missing.join(', ')} on chain ${config.CHAIN_ID}`,
      config.CHAIN_ID === 31337
        ? 'the local chain was probably restarted - redeploy with DeployLocal.s.sol, then update backend/.env from contracts/deployments/31337.json'
        : 'check the addresses against contracts/deployments/<chainId>.json',
    );
  }

  return { registry, factory, stablecoin };
}

/**
 * Insert or verify this chain's row. The stored addresses are a deployment fingerprint: if
 * they differ from the configuration, the database describes a different deployment and
 * continuing would interleave two histories under one chain id.
 */
export async function registerChain(db: Database, config: Config, logger?: Logger): Promise<void> {
  const existing = await db.maybe<{
    registry_address: string;
    factory_address: string;
    stablecoin_address: string;
  }>(
    'SELECT registry_address, factory_address, stablecoin_address FROM chains WHERE chain_id = $1',
    [config.CHAIN_ID],
  );

  if (existing === null) {
    await db.query(
      `INSERT INTO chains (chain_id, name, finality_confirmations, registry_address,
                           factory_address, stablecoin_address, start_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        config.CHAIN_ID,
        config.chainName,
        config.CONFIRMATIONS,
        config.addresses.registry,
        config.addresses.factory,
        config.addresses.stablecoin,
        config.START_BLOCK.toString(),
      ],
    );
    logger?.info({ chainId: config.CHAIN_ID }, 'registered chain');
    return;
  }

  const differences = (
    [
      ['REGISTRY_ADDRESS', existing.registry_address, config.addresses.registry],
      ['FACTORY_ADDRESS', existing.factory_address, config.addresses.factory],
      ['MUSD_ADDRESS', existing.stablecoin_address, config.addresses.stablecoin],
    ] as const
  ).filter(([, stored, configured]) => stored !== configured);

  if (differences.length > 0) {
    throw new StartupError(
      `database already holds a different deployment for chain ${config.CHAIN_ID}:\n` +
        differences
          .map(([key, stored, configured]) => `  ${key}: database=${stored} config=${configured}`)
          .join('\n'),
      'run "npm run db:reset" to index the new deployment from scratch',
    );
  }

  await db.query(
    'UPDATE chains SET finality_confirmations = $2, start_block = $3, updated_at = now() WHERE chain_id = $1',
    [config.CHAIN_ID, config.CONFIRMATIONS, config.START_BLOCK.toString()],
  );
}

/**
 * Compare the oldest worker cursor against the chain it claims to have read.
 *
 * Boundary B section 5: a cursor hash that no longer matches the chain AND an empty registry
 * address means the chain was replaced (a fresh Anvil), which is a refuse-to-run condition
 * rather than a reorg. A hash mismatch with the contracts still present is an ordinary
 * reorg, resolved by rolling back to the common ancestor in Milestone B.
 */
export async function inspectCursor(
  db: Database,
  client: ArcPublicClient,
  config: Config,
): Promise<CursorState> {
  const cursor = await db.maybe<CursorRow>(
    `SELECT worker, block_number, block_hash FROM indexer_cursors
     WHERE chain_id = $1 ORDER BY block_number ASC LIMIT 1`,
    [config.CHAIN_ID],
  );
  if (cursor === null) return { kind: 'no-cursor' };

  const rpcHash = await blockHashAt(client, cursor.block_number);
  if (rpcHash !== null && rpcHash === cursor.block_hash) {
    return {
      kind: 'ok',
      worker: cursor.worker,
      blockNumber: cursor.block_number,
      blockHash: cursor.block_hash,
    };
  }

  const registryHasCode = await hasCode(client, config.addresses.registry);
  if (!registryHasCode) {
    return {
      kind: 'restarted',
      worker: cursor.worker,
      blockNumber: cursor.block_number,
      storedHash: cursor.block_hash,
    };
  }

  return {
    kind: 'reorg',
    worker: cursor.worker,
    blockNumber: cursor.block_number,
    storedHash: cursor.block_hash,
    rpcHash,
  };
}

/** The full startup sequence. Throws StartupError rather than starting on bad ground. */
export async function assertChainReady(
  db: Database,
  client: ArcPublicClient,
  config: Config,
  logger?: Logger,
): Promise<ChainStateReport> {
  const rpcChainId = await verifyChainIdentity(client, config);
  const contractsPresent = await verifyDeploymentPresent(client, config);
  await registerChain(db, config, logger);

  const latestBlock = await client.getBlockNumber();
  const cursorState = await inspectCursor(db, client, config);

  if (cursorState.kind === 'restarted') {
    throw new StartupError(
      `chain ${config.CHAIN_ID} was replaced: the database cursor is at block ` +
        `${cursorState.blockNumber} (${cursorState.storedHash}) but that block no longer exists ` +
        'and the configured registry has no code',
      'run "npm run db:reset", redeploy, and update backend/.env with the new addresses',
    );
  }

  if (cursorState.kind === 'reorg') {
    logger?.warn(
      { blockNumber: cursorState.blockNumber, storedHash: cursorState.storedHash },
      'cursor block hash no longer matches the chain - reorg rollback required before indexing',
    );
  }

  return {
    configuredChainId: config.CHAIN_ID,
    rpcChainId,
    latestBlock,
    contractsPresent,
    cursorState,
  };
}

async function hasCode(client: ArcPublicClient, address: `0x${string}`): Promise<boolean> {
  const code = await client.getCode({ address });
  return code !== undefined && code !== '0x';
}

async function blockHashAt(client: ArcPublicClient, blockNumber: bigint): Promise<string | null> {
  try {
    const block = await client.getBlock({ blockNumber, includeTransactions: false });
    return block.hash;
  } catch {
    // Beyond the chain head after a restart, or pruned. Treated as "no longer there".
    return null;
  }
}
