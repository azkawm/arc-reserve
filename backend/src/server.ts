import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import type { ArcPublicClient } from './chain/client.js';
import { ApiError } from './lib/errors.js';
import { registerHealthRoute } from './api/routes/health.js';
import { registerAssetRoutes } from './api/routes/assets.js';
import { registerAccountRoutes } from './api/routes/accounts.js';
import { registerCandleRoutes } from './api/routes/candles.js';
import { ChainRegistry, type ChainClientFactory } from './api/chain-context.js';

export interface ServerDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  logger: Logger;
  version: string;
  startedAt?: number;
  /** Builds clients for chains other than the indexed one. Tests inject stubs; defaults to viem. */
  clientFactory?: ChainClientFactory;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, logger } = deps;

  const app = Fastify({
    // Annotated so Fastify keeps its default instance type instead of specialising on pino.
    loggerInstance: logger as FastifyBaseLogger,
    // Reject oversized bodies before they reach a handler; this API is read-only anyway.
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'OPTIONS'],
    credentials: false,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // The frontend polls /v1/health after every confirmed transaction until the block is
    // indexed (Boundary C section 5); that burst must not trip the limiter.
    allowList: () => false,
    keyGenerator: (request) => request.ip,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      request.log.warn({ code: error.code, err: error }, 'request failed');
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'BAD_REQUEST', message: 'rate limit exceeded' } });
    }

    // Never leak an internal message to a browser; the detail stays in the log.
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'internal server error' } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'BAD_REQUEST', message: `unknown route ${request.method} ${request.url}` } }),
  );

  // Built before health: health reports NAV risk for every chain this process can read, and it
  // must resolve those chains exactly as the asset routes do — each chain's own registry, through
  // that chain's own RPC.
  const chains = new ChainRegistry(config, deps.db, deps.client, deps.clientFactory);

  await registerHealthRoute(app, {
    config,
    db: deps.db,
    client: deps.client,
    chains,
    startedAt: deps.startedAt ?? Math.floor(Date.now() / 1000),
    version: deps.version,
    logger,
  });

  const apiDeps = { config, db: deps.db, client: deps.client, chains, logger };
  await registerAssetRoutes(app, apiDeps);
  await registerAccountRoutes(app, apiDeps);
  await registerCandleRoutes(app, apiDeps);

  return app;
}
