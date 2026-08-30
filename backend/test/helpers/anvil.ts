import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Helpers for the tests that run against a real local chain.
 *
 * These tests deliberately use a live Anvil rather than a mock: the properties under test —
 * that a replay reproduces the contracts' own view values, and that a rewound chain is
 * detected and rolled back — are properties of real logs and real block hashes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const deploymentsPath = resolve(here, '..', '..', '..', 'contracts', 'deployments', '31337.json');

export const ANVIL_RPC_URL = process.env.TEST_RPC_URL ?? 'http://127.0.0.1:8545';

/** Anvil's first two default accounts: #0 is issuer/verifier/admin/keeper, #1 the investor. */
export const ANVIL_ACCOUNTS = {
  deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  investor: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
} as const;

export interface LocalDeployment {
  assetId: string;
  registry: string;
  factory: string;
  mockUSD: string;
  token: string;
  vault: string;
  offering: string;
  marketManager: string;
  revenueDistributor: string;
  redemptionController: string;
  pool: string;
  identityRegistry: string;
  compliance: string;
  [key: string]: string;
}

export function readLocalDeployment(): LocalDeployment {
  if (!existsSync(deploymentsPath)) {
    throw new Error(
      `no local deployment at ${deploymentsPath}\n` +
        'Run: anvil, then `forge script script/DeployLocal.s.sol:DeployLocal ' +
        '--rpc-url http://127.0.0.1:8545 --broadcast` in contracts/.',
    );
  }
  return JSON.parse(readFileSync(deploymentsPath, 'utf8')) as LocalDeployment;
}

let rpcId = 0;

export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(ANVIL_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: (rpcId += 1), method, params }),
  });

  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/**
 * Assert the chain is up and actually carries the deployment the tests expect. Fails with
 * instructions rather than skipping: a silently skipped acceptance test is worse than a red
 * one.
 */
export async function requireAnvil(deployment: LocalDeployment): Promise<void> {
  let chainId: string;
  try {
    chainId = await rpc<string>('eth_chainId');
  } catch (error) {
    throw new Error(
      `no chain at ${ANVIL_RPC_URL}: ${(error as Error).message}\nStart it with \`anvil\`.`,
    );
  }

  if (Number(chainId) !== 31337) {
    throw new Error(`expected chain 31337 at ${ANVIL_RPC_URL}, got ${Number(chainId)}`);
  }

  const code = await rpc<string>('eth_getCode', [deployment.registry, 'latest']);
  if (code === '0x') {
    throw new Error(
      `no registry code at ${deployment.registry} — the chain was restarted since the last deploy.\n` +
        'Re-run DeployLocal.s.sol against this Anvil.',
    );
  }
}

/**
 * Anvil auto-unlocks its default accounts, so no key material is needed to send a call.
 *
 * The receipt is waited for and its status checked: a reverted transaction still mines a
 * block, so a test that only sends would happily "succeed" while indexing nothing.
 */
export async function sendTransaction(from: string, to: string, data: string): Promise<string> {
  const hash = await rpc<string>('eth_sendTransaction', [{ from, to, data }]);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const receipt = await rpc<{ status: string; blockNumber: string } | null>(
      'eth_getTransactionReceipt',
      [hash],
    );
    if (receipt !== null) {
      if (receipt.status !== '0x1') {
        throw new Error(`transaction ${hash} reverted (to ${to})`);
      }
      return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`no receipt for ${hash} after 2.5s`);
}

export async function mine(blocks = 1): Promise<void> {
  await rpc('anvil_mine', [`0x${blocks.toString(16)}`]);
}

export async function snapshot(): Promise<string> {
  return rpc<string>('evm_snapshot');
}

/** Rewinds the chain, which changes every block hash above the snapshot: a real reorg. */
export async function revertTo(id: string): Promise<boolean> {
  return rpc<boolean>('evm_revert', [id]);
}

export async function blockNumber(): Promise<bigint> {
  return BigInt(await rpc<string>('eth_blockNumber'));
}
