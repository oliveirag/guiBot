import type { Suggestion } from '@prisma/client';
import type { Client } from 'discord.js';
import { editIn } from '../../sd/lib/post.js';
import { renderSuggestion, tally, type Author } from './suggestions.js';

export async function authorOf(client: Client, userId: string): Promise<Author> {
  const user = await client.users.fetch(userId).catch(() => null);
  return user ? { name: user.displayName, avatarUrl: user.displayAvatarURL() } : { name: 'Someone' };
}

/** Redraws the suggestion message with the latest status and votes. */
export async function refresh(client: Client, s: Suggestion): Promise<boolean> {
  if (!s.messageId) return false;
  const view = renderSuggestion(s, await tally(s.id), await authorOf(client, s.authorId));
  return editIn(client, s.channelId, s.messageId, view);
}
