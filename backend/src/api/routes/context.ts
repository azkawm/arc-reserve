import type { Logger } from 'pino';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import type { ArcPublicClient } from '../../chain/client.js';

/** What every `/v1` data route needs. */
export interface ApiDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  logger: Logger;
}
