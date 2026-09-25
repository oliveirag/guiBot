import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { reactionKey } from './assignable.js';

export const MAX_REACTION_ROLES = 100;

/** Parses a message link into channel and message ids. */
export function parseMessageLink(link: string): { guildId: string; channelId: string; messageId: string } | null {
  const m = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/.exec(link.trim());
  return m ? { guildId: m[1]!, channelId: m[2]!, messageId: m[3]! } : null;
}

/** Adds or removes the mapped role when someone reacts. */
export async function applyReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean,
): Promise<void> {
  if (user.bot || !reaction.message.guildId) return;
  const key = reactionKey(reaction.emoji);
  const mapping = await prisma.reactionRole.findUnique({
    where: { messageId_emoji: { messageId: reaction.message.id, emoji: key } },
  });
  if (!mapping) return;
  try {
    const guild = await reaction.client.guilds.fetch(mapping.guildId);
    const member = await guild.members.fetch(user.id);
    if (add) await member.roles.add(mapping.roleId, 'Reaction role');
    else await member.roles.remove(mapping.roleId, 'Reaction role');
  } catch (error) {
    log.warn(`roles: reaction role ${mapping.roleId} failed`, error);
  }
}
