import type { Message } from 'discord.js';
import { Tracker, editRules, findViolation } from './engine.js';
import { enforce, isExempt } from './enforce.js';
import { getAutomod } from './settings.js';

const tracker = new Tracker();

/** Runs automod on a new or edited message. Edits skip spam and duplicates and don't count as sends. */
export async function checkMessage(message: Message, edited: boolean): Promise<void> {
  if (message.author.bot || !message.inGuild() || !message.member || message.system) return;
  const config = await getAutomod(message.guildId);
  if (config.rules.size === 0) return;

  const channel = message.channel;
  const channelIds = channel.isThread() && channel.parentId ? [channel.id, channel.parentId] : [channel.id];
  if (isExempt(config, message.member, channelIds)) return;

  const key = `${message.guildId}:${message.author.id}`;
  const facts = {
    content: message.content,
    mentionCount: message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id).size + message.mentions.roles.size,
    at: edited ? (message.editedTimestamp ?? Date.now()) : message.createdTimestamp,
  };
  const rules = edited ? editRules(config.rules) : config.rules;
  const history = edited ? [] : tracker.record(key, facts);
  const violation = findViolation({ facts, history, rules, words: config.words, allowedDomains: config.allowedDomains });
  if (!violation) return;
  // Start the count over so one burst isn't punished message after message.
  if (violation.rule === 'spam' || violation.rule === 'duplicates') tracker.forget(key);
  await enforce(message, violation, config.rules.get(violation.rule)!);
}
