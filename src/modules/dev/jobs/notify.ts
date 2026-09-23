import { RESTJSONErrorCodes } from 'discord.js';
import { z } from 'zod';
import { job } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { removeFeedsForChannel } from '../lib/feeds.js';
import { NOTIFY_JOB } from '../lib/ingest.js';
import { renderEvent } from '../lib/render.js';

const payloadSchema = z.object({ eventId: z.number().int(), channelId: z.string() });

const GONE = new Set<unknown>([RESTJSONErrorCodes.UnknownChannel]);
const FORBIDDEN = new Set<unknown>([RESTJSONErrorCodes.MissingAccess, RESTJSONErrorCodes.MissingPermissions]);

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

async function dropChannel(channelId: string): Promise<void> {
  const removed = await removeFeedsForChannel(channelId);
  log.warn(`dev.notify: channel ${channelId} is gone, removed ${removed} feed(s)`);
}

/** Missing channel or perms won't fix themselves, so those end the job instead of retrying. */
async function handled(error: unknown, channelId: string): Promise<boolean> {
  if (GONE.has(codeOf(error))) {
    await dropChannel(channelId);
    return true;
  }
  if (FORBIDDEN.has(codeOf(error))) {
    log.warn(`dev.notify: no permission to post in ${channelId}`);
    return true;
  }
  return false;
}

export default job({
  type: NOTIFY_JOB,
  async run(payload, { client }) {
    const { eventId, channelId } = payloadSchema.parse(payload);
    const event = await prisma.devEvent.findUnique({ where: { id: eventId } });
    if (!event) return;

    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (error) {
      if (await handled(error, channelId)) return;
      throw error;
    }
    if (!channel?.isSendable()) {
      await dropChannel(channelId);
      return;
    }

    try {
      await channel.send({ embeds: [renderEvent(event)] });
    } catch (error) {
      if (await handled(error, channelId)) return;
      throw error;
    }
  },
});
