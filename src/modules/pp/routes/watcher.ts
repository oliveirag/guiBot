import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { routes } from '../../../core/define.js';
import { parseLineups } from '../lib/lineups.js';
import { ingestSlips, markCheckIn, serialized, watchedProfiles } from '../lib/tracks.js';

const bodySchema = z.object({
  profileId: z.string().regex(/^[A-Za-z0-9]{4,20}$/),
  profile: z.object({ username: z.string().nullish(), avatarUrl: z.string().url().nullish() }).optional(),
  lineups: z.unknown(),
});

function matches(secret: string, header: string | undefined): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export default routes(async (app, { env, log, client }) => {
  // The watcher lives on Gui's Mac and talks to these two routes with PP_WATCHER_TOKEN.
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.ppWatcherToken) return reply.code(503).send({ error: 'PP_WATCHER_TOKEN is not set' });
    if (!matches(env.ppWatcherToken, request.headers.authorization)) return reply.code(401).send({ error: 'Bad token' });
    markCheckIn();
  };

  app.get('/pp/profiles', { preHandler: guard }, async () => ({ profiles: await watchedProfiles() }));

  app.post('/pp/lineups', { preHandler: guard, bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Expected { profileId, lineups }' });
    if (!client) return reply.code(503).send({ error: 'Discord client not ready' });
    const { profileId, profile, lineups } = parsed.data;
    try {
      const slips = parseLineups(lineups);
      const result = await serialized(() => ingestSlips(client, profileId, slips, profile ?? {}));
      return { slips: slips.length, ...result };
    } catch (error) {
      log.error(`pp: ingest for ${profileId} failed`, error);
      return reply.code(500).send({ error: 'Ingest failed' });
    }
  });
});
