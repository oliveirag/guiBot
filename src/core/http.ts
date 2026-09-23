import Fastify, { type FastifyInstance } from 'fastify';
import type { HttpDeps, HttpRoutes } from './types.js';

export interface ServerOptions {
  routes: HttpRoutes[];
  deps: HttpDeps;
}

export function buildServer(opts?: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ ok: true }));
  if (opts) {
    // One encapsulated scope per routes file, so parser changes stay local to it.
    for (const plugin of opts.routes) app.register(async (scope) => plugin(scope, opts.deps));
  }
  return app;
}

// GitHub caps webhook payloads at 25 MB. Fastify's default limit is 1 MB.
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

/** In this scope, JSON bodies arrive as raw Buffers so webhook signatures can be checked. */
export function acceptRawJson(app: FastifyInstance, bodyLimit = WEBHOOK_BODY_LIMIT): void {
  app.removeContentTypeParser(['application/json']);
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => {
    done(null, body);
  });
}
