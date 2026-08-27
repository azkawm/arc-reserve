import type { FastifyInstance } from 'fastify';
import { buildMeta, respond } from '../envelope.js';
import { healthSchema } from '../schemas/health.js';
import { collectHealth, type HealthDeps } from '../../observability/health.js';

/**
 * `GET /v1/health`
 *
 * Deliberately returns the data envelope in every case, including failure: an operator
 * reading this route needs the detail, and the frontend polls it to decide whether a
 * just-confirmed transaction has been indexed yet (Boundary C section 5).
 *
 * The HTTP status is a readiness signal for probes: 200 while the service can answer
 * truthfully, 503 once it cannot.
 */
export async function registerHealthRoute(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  app.get('/v1/health', async (_request, reply) => {
    const { payload, cursor, latestBlock } = await collectHealth(deps);

    const meta = buildMeta({
      chainId: deps.config.CHAIN_ID,
      // Operational state read from this service's own database and RPC, not a chain value.
      provenance: 'derived',
      staleAfterSeconds: deps.config.STALE_AFTER_SECONDS,
      cursor,
      latestBlock,
    });

    return respond(reply, healthSchema, payload, meta, payload.status === 'unhealthy' ? 503 : 200);
  });
}
