import type { ArcPublicClient } from '../../src/chain/client.js';
import { loadConfig, type Config } from '../../src/config.js';

export const TEST_ADDRESSES = {
  registry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  factory: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  musd: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
};

export function testConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://arcreserve:arcreserve@127.0.0.1:5450/arcreserve_test',
    CHAIN_ID: '31337',
    RPC_HTTP_URL: 'http://127.0.0.1:8545',
    REGISTRY_ADDRESS: TEST_ADDRESSES.registry,
    FACTORY_ADDRESS: TEST_ADDRESSES.factory,
    MUSD_ADDRESS: TEST_ADDRESSES.musd,
    ...overrides,
  });
}

export interface StubChain {
  chainId?: number;
  latestBlock?: bigint;
  /** Lowercase address -> has code. Anything absent is treated as deployed. */
  code?: Record<string, boolean>;
  /** Lowercase address -> exact bytecode, for tests that inspect code (e.g. the mock-pool check). */
  bytecode?: Record<string, string>;
  /** Block number -> hash. A number that is absent behaves like a block past the head. */
  blocks?: Record<string, string>;
  failWith?: Error;
}

/**
 * A hand-written stub rather than a mocked viem client: these tests are about how the
 * service reacts to what the chain says, and a stub makes "the chain was replaced" a
 * one-line scenario.
 */
export function stubClient(options: StubChain = {}): ArcPublicClient {
  const {
    chainId = 31337,
    latestBlock = 100n,
    code = {},
    bytecode = {},
    blocks = {},
    failWith,
  } = options;

  const stub = {
    async getChainId() {
      if (failWith) throw failWith;
      return chainId;
    },
    async getBlockNumber() {
      if (failWith) throw failWith;
      return latestBlock;
    },
    async getCode({ address }: { address: string }) {
      if (failWith) throw failWith;
      const exact = bytecode[address.toLowerCase()];
      if (exact !== undefined) return exact;
      const has = code[address.toLowerCase()] ?? true;
      return has ? '0x60806040' : '0x';
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      if (failWith) throw failWith;
      const hash = blocks[blockNumber.toString()];
      if (hash === undefined) throw new Error('block not found');
      return { number: blockNumber, hash, parentHash: hash, timestamp: 1_786_932_000n };
    },
  };

  return stub as unknown as ArcPublicClient;
}
