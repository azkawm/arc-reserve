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

export function defineArcChain(config: Config) {
  return defineChain({
    id: config.CHAIN_ID,
    name: config.chainName,
    nativeCurrency: NATIVE_CURRENCY[config.CHAIN_ID],
    rpcUrls: { default: { http: [config.RPC_HTTP_URL] } },
    testnet: true,
  });
}

export type ArcPublicClient = PublicClient;

export function createChainClient(config: Config): ArcPublicClient {
  return createPublicClient({
    chain: defineArcChain(config),
    // viem caches `getBlockNumber` for `cacheTime` (defaulting to the polling interval, 4s).
    // An indexer must never read a cached head: it would decide there is nothing new, skip
    // blocks that already exist, and report a lag that is an artefact of its own cache.
    cacheTime: 0,
    pollingInterval: config.POLL_INTERVAL_MS,
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
