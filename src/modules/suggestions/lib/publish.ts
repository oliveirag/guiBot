import type { Suggestion } from '@prisma/client';
import type { Client } from 'discord.js';
import { editIn } from '../../sd/lib/post.js';
import { ANONYMOUS, renderSuggestion, tally, type Author } from './suggestions.js';

export async function authorOf(client: Client, s: Pick<Suggestion, 'authorId' | 'anonymous'>): Promise<Author> {
  if (s.anonymous) return ANONYMOUS;
  const user = await client.users.fetch(s.authorId).catch(() => null);
  return user ? { name: user.displayName, avatarUrl: user.displayAvatarURL() } : { name: 'Someone' };
}

/** Redraws the suggestion message with the latest status and votes. */
export async function refresh(client: Client, s: Suggestion): Promise<boolean> {
  if (!s.messageId) return false;
  const view = renderSuggestion(s, await tally(s.id), await authorOf(client, s));
  return editIn(client, s.channelId, s.messageId, view);
}
