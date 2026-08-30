import { createRequire } from 'node:module';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config.js';
import { createLogger } from './observability/logger.js';
import { createDatabase } from './db/client.js';
import { createChainClient } from './chain/client.js';
import { assertChainReady } from './chain/identity.js';
import { buildServer } from './server.js';
import { Indexer } from './indexer/runner.js';
import { StartupError } from './lib/errors.js';

/**
 * Process entry point.
 *
 * Order matters: configuration, then database, then chain identity, and only then does the
 * server listen. Nothing is served until the service knows it is talking to the chain and
 * the deployment it was configured for.
 */

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

async function main(): Promise<void> {
  loadDotenv();

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, !config.isProduction);
  const startedAt = Math.floor(Date.now() / 1000);

  logger.info(
    {
      chainId: config.CHAIN_ID,
      chain: config.chainName,
      registry: config.addresses.registry,
      allowMockMarketData: config.ALLOW_MOCK_MARKET_DATA,
    },
    'arcreserve backend starting (testnet only, D-027)',
  );

  const db = createDatabase(config.DATABASE_URL, logger);
  const client = createChainClient(config);

  const report = await assertChainReady(db, client, config, logger);
  logger.info(
    {
      rpcChainId: report.rpcChainId,
      latestBlock: report.latestBlock.toString(),
      cursor: report.cursorState.kind,
    },
    'chain verified',
  );

  // API and indexer share one process for the demo (BACKEND_INDEXER.md section 3). They keep
  // separate modules and separate database transactions so they can be split later.
  const indexer = new Indexer({ config, db, client, logger });
  await indexer.prepare();

  const app = await buildServer({ config, db, client, logger, version, startedAt });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await indexer.stop();
    await app.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ url: `http://${config.HOST}:${config.PORT}/v1/health` }, 'listening');

  await indexer.start();
  logger.info({ startBlock: config.START_BLOCK.toString() }, 'indexer running');
}

main().catch((error: unknown) => {
  if (error instanceof StartupError) {
    // A startup failure is an operator message, not a stack trace.
    process.stderr.write(`\narcreserve backend cannot start:\n  ${error.message}\n`);
    if (error.hint) process.stderr.write(`\n  hint: ${error.hint}\n`);
    process.stderr.write('\n');
    process.exit(1);
  }
  process.stderr.write(`\narcreserve backend crashed during startup:\n${String(error)}\n\n`);
  process.exit(1);
});
