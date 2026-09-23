import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '../../../core/log.js';
import { ingest } from './ingest.js';
import { verifySignature } from './signature.js';
import type { FeedSource, NormalizedEvent } from './types.js';

export interface WebhookSpec {
  source: FeedSource;
  secret: string | undefined;
  signatureHeader: string;
  deliveryHeader: string;
  /** Returns null for pings and anything else that needs a 200 and no storage. */
  normalize(payload: unknown, request: FastifyRequest): NormalizedEvent[] | null;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function webhookHandler(spec: WebhookSpec, log: Logger) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!spec.secret) return reply.code(503).send({ error: `${spec.source} webhooks are not configured` });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Send the webhook as application/json' });
    if (!verifySignature(spec.secret, request.body, header(request, spec.signatureHeader))) {
      return reply.code(401).send({ error: 'Bad signature' });
    }
    const delivery = header(request, spec.deliveryHeader);
    if (!delivery) return reply.code(400).send({ error: `Missing ${spec.deliveryHeader}` });

    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    const events = spec.normalize(payload, request);
    if (events === null) return reply.code(200).send({ ok: true });

    try {
      const result = await ingest(`${spec.source}:${delivery}`, events);
      return reply.code(result.duplicate ? 200 : 202).send(result);
    } catch (error) {
      log.error(`${spec.source} webhook ${delivery} failed`, error);
      return reply.code(500).send({ error: 'Could not store the event' });
    }
  };
}
