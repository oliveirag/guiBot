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

const ignoreCache = new Map<string, Set<string>>();

export async function getIgnored(guildId: string): Promise<ReadonlySet<string>> {
  const hit = ignoreCache.get(guildId);
  if (hit) return hit;
  const rows = await prisma.logIgnore.findMany({ where: { guildId } });
  const ids = new Set(rows.map((r) => r.channelId));
  ignoreCache.set(guildId, ids);
  return ids;
}

/** Flips a channel in or out of the ignore list. True when it's now ignored. */
export async function toggleIgnored(guildId: string, channelId: string): Promise<boolean> {
  const key = { guildId_channelId: { guildId, channelId } };
  const existing = await prisma.logIgnore.findUnique({ where: key });
  if (existing) await prisma.logIgnore.delete({ where: key });
  else await prisma.logIgnore.create({ data: { guildId, channelId } });
  ignoreCache.delete(guildId);
  return !existing;
}

/** The channel, its parent (category, or channel for a thread), and the parent's parent (a thread's category). */
export function channelChain(client: Client, channelId: string): string[] {
  const chain = [channelId];
  let current = client.channels.cache.get(channelId);
  for (let i = 0; i < 2 && current && 'parentId' in current && current.parentId; i++) {
    chain.push(current.parentId);
    current = client.channels.cache.get(current.parentId);
  }
  return chain;
}

/** True when the channel, or a category or channel it sits under, is on the ignore list. */
export async function isIgnored(client: Client, guildId: string, channelId: string): Promise<boolean> {
  const ignored = await getIgnored(guildId);
  return ignored.size > 0 && channelChain(client, channelId).some((id) => ignored.has(id));
}

export function clearLogCache(): void {
  cache.clear();
  ignoreCache.clear();
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
