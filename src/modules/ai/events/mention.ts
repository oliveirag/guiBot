import { Events, type Message } from 'discord.js';
import { event } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { processEnv } from '../../../env.js';
import { createGemini } from '../lib/gemini.js';
import { fetchHistory } from '../lib/history.js';
import { answer, checkGate, failureMessage } from '../lib/reply.js';

type Incoming = Pick<Message, 'author' | 'mentions' | 'inGuild'>;

/** Direct @mentions and replies to the bot. Not @everyone, and never other bots. */
export function isForBot(message: Incoming, botId: string): boolean {
  if (message.author.bot || !message.inGuild()) return false;
  return message.mentions.users.has(botId) || message.mentions.repliedUser?.id === botId;
}

export function stripMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
}

export default event({
  name: Events.MessageCreate,
  async run(message: Message) {
    const botId = message.client.user.id;
    if (!isForBot(message, botId) || !message.inGuild()) return;
    const env = processEnv();
    if (!env.gemini) return;

    const channel = message.channel;
    const toggleId = channel.isThread() ? (channel.parentId ?? channel.id) : channel.id;
    const gate = await checkGate(message.guildId, toggleId, message.author.id, env.ownerIds);
    if (!gate.allowed) {
      if (gate.reason === 'cooldown') await message.react('⏳').catch(() => {});
      return;
    }

    await channel.sendTyping().catch(() => {});
    let content: string;
    try {
      content = await answer({
        guildId: message.guildId,
        jira: env.jira,
        generate: createGemini(env.gemini),
        history: await fetchHistory(channel, botId, message.id),
        asker: message.member?.displayName ?? message.author.displayName,
        question: stripMention(message.content, botId),
      });
    } catch (error) {
      log.warn('ai: mention reply failed', error);
      content = failureMessage(error);
    }
    await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  },
});
