import pino from 'pino';
import type { Logger } from 'pino';

/**
 * One structured logger for the whole process — startup, indexer, and HTTP.
 * Redaction is deliberate: this service holds no keys, but a connection string in a log
 * line is still a credential leak (BACKEND_INDEXER.md s16).
 */
export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: {
      paths: ['DATABASE_URL', 'config.DATABASE_URL', 'req.headers.authorization', 'password'],
      censor: '[redacted]',
    },
    ...(pretty
      ? { transport: { target: 'pino/file', options: { destination: 1 } } }
      : {}),
  });
}

export type { Logger };
