import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import type { ArcPublicClient } from './chain/client.js';
import { ApiError } from './lib/errors.js';
import { registerHealthRoute } from './api/routes/health.js';

export interface ServerDeps {
  config: Config;
  db: Database;
  client: ArcPublicClient;
  logger: Logger;
  version: string;
  startedAt?: number;
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

  await registerHealthRoute(app, {
    config,
    db: deps.db,
    client: deps.client,
    startedAt: deps.startedAt ?? Math.floor(Date.now() / 1000),
    version: deps.version,
  });

  return app;
}
