import type { Logger } from 'pino';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import type { ArcPublicClient } from '../../chain/client.js';
import type { ChainRegistry } from '../chain-context.js';

/** What every `/v1` data route needs. */
export interface ApiDeps {
  config: Config;
  db: Database;
  /** The indexed chain's client. Route handlers read the request's chain from `chains`. */
  client: ArcPublicClient;
  chains: ChainRegistry;
  logger: Logger;
}
