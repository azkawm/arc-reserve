import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import type { Config, SupportedChainId } from '../config.js';

/**
 * Read-only RPC. This service has no account, no signer and no private key (BACKEND_INDEXER
 * s16); it can only call `eth_call`, `eth_getLogs` and block reads.
 */

const NATIVE_CURRENCY: Record<SupportedChainId, { name: string; symbol: string; decimals: number }> = {
  31337: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  84532: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  296: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
};

/**
 * Multicall3, where the chain has one. Without it a single asset page is dozens of `eth_call`s,
 * which the public Base Sepolia endpoint answers with "over rate limit" rather than data. Anvil
 * has no Multicall3 (DeployLocal does not deploy one) and neither does the Hedera relay, so this
 * is per chain rather than a blanket flag.
 */
const MULTICALL3: Partial<
  Record<SupportedChainId, { address: `0x${string}`; blockCreated: number }>
> = {
  84532: { address: '0xca11bde05977b3631167028862be2a173976ca11', blockCreated: 1_059_647 },
};

export function defineArcChain(config: Config) {
  const multicall3 = MULTICALL3[config.CHAIN_ID];
  return defineChain({
    id: config.CHAIN_ID,
    name: config.chainName,
    nativeCurrency: NATIVE_CURRENCY[config.CHAIN_ID],
    rpcUrls: { default: { http: [config.RPC_HTTP_URL] } },
    testnet: true,
    ...(multicall3 === undefined ? {} : { contracts: { multicall3 } }),
  });
}

export type ArcPublicClient = PublicClient;

export function createChainClient(config: Config): ArcPublicClient {
  const chain = defineArcChain(config);
  return createPublicClient({
    chain,
    // viem caches `getBlockNumber` for `cacheTime` (defaulting to the polling interval, 4s).
    // An indexer must never read a cached head: it would decide there is nothing new, skip
    // blocks that already exist, and report a lag that is an artefact of its own cache.
    cacheTime: 0,
    pollingInterval: config.POLL_INTERVAL_MS,
    // Collapses the snapshot's reads into one `eth_call` where Multicall3 exists. Nothing is
    // batched across block numbers: viem groups by block, and every snapshot read is pinned to
    // the indexed block, so a batched read is still one consistent view.
    ...(chain.contracts?.multicall3 === undefined ? {} : { batch: { multicall: true } }),
    transport: http(config.RPC_HTTP_URL, {
      // Hedera's JSON-RPC relay is slower and rate limited; one retry with backoff keeps a
      // transient 429 from being reported as an indexing failure.
      retryCount: 3,
      retryDelay: 250,
      timeout: 15_000,
      batch: config.CHAIN_ID === 296 ? false : { wait: 16 },
    }),
  }) as ArcPublicClient;
}
