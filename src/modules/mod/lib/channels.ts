import type { GuildBasedChannel, Role } from 'discord.js';

const FOURTEEN_DAYS = 14 * 86_400_000;
const LINK = /https?:\/\/\S+/i;

export interface PurgeCandidate {
  id: string;
  authorId: string;
  authorBot: boolean;
  content: string;
  createdTimestamp: number;
  pinned: boolean;
}

export interface PurgeFilter {
  userId?: string | null;
  bots?: boolean;
  links?: boolean;
  match?: string | null;
}

/** Newest first. Skips pins and anything Discord won't bulk delete (older than 14 days). */
export function pickPurge(messages: PurgeCandidate[], filter: PurgeFilter, count: number, now = Date.now()): string[] {
  const match = filter.match?.toLowerCase();
  return messages
    .filter((m) => !m.pinned && now - m.createdTimestamp < FOURTEEN_DAYS)
    .filter((m) => !filter.userId || m.authorId === filter.userId)
    .filter((m) => !filter.bots || m.authorBot)
    .filter((m) => !filter.links || LINK.test(m.content))
    .filter((m) => !match || m.content.toLowerCase().includes(match))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .slice(0, count)
    .map((m) => m.id);
}

type Lockable = Extract<GuildBasedChannel, { permissionOverwrites: unknown }>;

export function isLockable(channel: GuildBasedChannel): channel is Lockable {
  return 'permissionOverwrites' in channel && (channel.isTextBased() || channel.isThreadOnly());
}

/** Locks by denying @everyone, unlocks by clearing that deny (back to whatever the category says). */
export async function setLocked(channel: Lockable, everyone: Role, locked: boolean, reason: string): Promise<void> {
  await channel.permissionOverwrites.edit(
    everyone,
    { SendMessages: locked ? false : null, SendMessagesInThreads: locked ? false : null, CreatePublicThreads: locked ? false : null },
    { reason },
  );
}
