import type { Client, Message, MessageCreateOptions } from 'discord.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { isPermanent } from '../../sd/lib/post.js';

export const LOG_KINDS = ['messages', 'members', 'roles', 'voice', 'modlog'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const LOG_LABELS: Record<LogKind, string> = {
  messages: 'Message edits and deletes',
  members: 'Joins and leaves',
  roles: 'Role and nickname changes',
  voice: 'Voice joins, leaves, and moves',
  modlog: 'Moderation cases',
};

// Message events fire constantly, so routes are cached. Single process, and every write goes through setRoute.
const cache = new Map<string, Map<LogKind, string>>();

export async function getRoutes(guildId: string): Promise<ReadonlyMap<LogKind, string>> {
  const hit = cache.get(guildId);
  if (hit) return hit;
  const rows = await prisma.logRoute.findMany({ where: { guildId } });
  const routes = new Map(rows.map((r) => [r.kind as LogKind, r.channelId]));
  cache.set(guildId, routes);
  return routes;
}

export async function setRoute(guildId: string, kind: LogKind, channelId: string | null): Promise<void> {
  if (channelId) {
    await prisma.logRoute.upsert({
      where: { guildId_kind: { guildId, kind } },
      create: { guildId, kind, channelId },
      update: { channelId },
    });
  } else {
    await prisma.logRoute.deleteMany({ where: { guildId, kind } });
  }
  cache.delete(guildId);
}

export function clearLogCache(): void {
  cache.clear();
}

/** Posts to the guild's channel for `kind`. Null when there's no route, logs are off, or the channel is gone. */
export async function postLog(
  client: Client,
  guildId: string,
  kind: LogKind,
  message: MessageCreateOptions,
): Promise<Message | null> {
  const channelId = (await getRoutes(guildId)).get(kind);
  if (!channelId || !(await isModuleEnabled(guildId, 'logs'))) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) return null;
    return await channel.send({ allowedMentions: { parse: [] }, ...message });
  } catch (error) {
    if (!isPermanent(error)) throw error;
    log.warn(`logs: can't post ${kind} logs in ${channelId}`);
    return null;
  }
}
