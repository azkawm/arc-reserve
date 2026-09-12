import { ApiError } from '../lib/errors.js';
import { SUPPORTED_CHAIN_IDS, type Config, type SupportedChainId } from '../config.js';
import { createChainClientFor, type ArcPublicClient } from '../chain/client.js';
import type { Database } from '../db/client.js';

/**
 * Which chain a request is about (Boundary C: `?chainId=` on every asset route).
 *
 * One database holds every chain (D-030), so the read model can answer for a chain this process
 * does not index. The live contract reads cannot: they need that chain's own RPC. A chain is
 * therefore servable only when it has both rows in `chains` and an endpoint configured, and a
 * request for any other chain is an error — never a silent fallback to the configured chain,
 * which would answer about Anvil while saying Base Sepolia.
 */
export interface ChainContext {
  chainId: SupportedChainId;
  client: ArcPublicClient;
  /** The registry the indexer recorded for this chain, not the configured one. */
  registry: `0x${string}`;
}

interface ChainRow {
  chain_id: string | number;
  registry_address: string;
}

export class ChainRegistry {
  private readonly clients = new Map<SupportedChainId, ArcPublicClient>();

  constructor(
    private readonly config: Config,
    private readonly db: Database,
    primaryClient: ArcPublicClient,
  ) {
    // The indexed chain always uses the client the process was built with: it is the one
    // `assertChainReady` verified, and in tests it is the stub the test injected.
    this.clients.set(config.CHAIN_ID, primaryClient);
  }

  /** `undefined` means "the chain this process indexes". */
  async resolve(requested: number | undefined): Promise<ChainContext> {
    const chainId = requested ?? this.config.CHAIN_ID;

    if (!SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)) {
      throw ApiError.badRequest(
        `unsupported chainId ${chainId}. ArcReserve is testnet only (D-027): ` +
          `${SUPPORTED_CHAIN_IDS.join(', ')}`,
      );
    }
    const supported = chainId as SupportedChainId;

    const row = await this.db.maybe<ChainRow>(
      'SELECT chain_id, registry_address FROM chains WHERE chain_id = $1',
      [supported],
    );
    if (row === null) {
      const known = await this.db.query<{ chain_id: string }>(
        'SELECT chain_id FROM chains ORDER BY chain_id',
      );
      const indexed = known.rows.map((chain) => chain.chain_id).join(', ');
      throw ApiError.badRequest(
        `chain ${supported} has not been indexed into this database` +
          (indexed === '' ? '' : `; indexed chains: ${indexed}`),
      );
    }

    return { chainId: supported, client: this.clientFor(supported), registry: registryOf(row) };
  }

  private clientFor(chainId: SupportedChainId): ArcPublicClient {
    const existing = this.clients.get(chainId);
    if (existing !== undefined) return existing;

    const rpcUrl = this.config.rpcUrls[chainId];
    if (rpcUrl === undefined) {
      // 503 rather than 404: the data exists, this deployment just cannot read that chain's
      // contract state. Serving the projections alone would mix a real read model with missing
      // live values under an `onchain` label.
      throw new ApiError(
        'CHAIN_UNAVAILABLE',
        `chain ${chainId} is indexed but this API has no RPC for it: set RPC_HTTP_URL_${chainId}`,
      );
    }

    const client = createChainClientFor(chainId, rpcUrl, this.config.POLL_INTERVAL_MS);
    this.clients.set(chainId, client);
    return client;
  }
}

function registryOf(row: ChainRow): `0x${string}` {
  return row.registry_address.toLowerCase() as `0x${string}`;
}
