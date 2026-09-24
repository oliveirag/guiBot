import type { Message, TextBasedChannel } from 'discord.js';
import { log } from '../../../core/log.js';
import { HISTORY_LIMIT, type ChatLine } from './context.js';

type HistoryMessage = Pick<Message, 'content' | 'author' | 'member' | 'createdTimestamp'>;

export function toChatLines(messages: Iterable<HistoryMessage>, botId: string): ChatLine[] {
  return [...messages]
    .filter((m) => m.content && (!m.author.bot || m.author.id === botId))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((m) => ({
      author: m.author.id === botId ? 'guiBot (you)' : (m.member?.displayName ?? m.author.displayName ?? m.author.username),
      content: m.content,
    }));
}

/** The last few messages before `before` (or the newest ones), oldest first. Empty if the bot can't read history. */
export async function fetchHistory(channel: TextBasedChannel, botId: string, before?: string): Promise<ChatLine[]> {
  try {
    const messages = await channel.messages.fetch({ limit: HISTORY_LIMIT, ...(before ? { before } : {}) });
    return toChatLines(messages.values(), botId);
  } catch (error) {
    log.warn('ai: could not read channel history', error);
    return [];
  }
}
