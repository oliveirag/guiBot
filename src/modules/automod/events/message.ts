import { Events, type Message } from 'discord.js';
import { event } from '../../../core/define.js';
import { Tracker, findViolation } from '../lib/engine.js';
import { enforce, isExempt } from '../lib/enforce.js';
import { getAutomod } from '../lib/settings.js';

const tracker = new Tracker();

export default event({
  name: Events.MessageCreate,
  async run(message: Message) {
    if (message.author.bot || !message.inGuild() || !message.member || message.system) return;
    const config = await getAutomod(message.guildId);
    if (config.rules.size === 0) return;

    const channel = message.channel;
    const channelIds = channel.isThread() && channel.parentId ? [channel.id, channel.parentId] : [channel.id];
    if (isExempt(config, message.member, channelIds)) return;

    const facts = {
      content: message.content,
      mentionCount: message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id).size + message.mentions.roles.size,
      at: message.createdTimestamp,
    };
    const history = tracker.record(`${message.guildId}:${message.author.id}`, facts);
    const violation = findViolation({ facts, history, rules: config.rules, words: config.words, allowedDomains: config.allowedDomains });
    if (!violation) return;
    // Start the count over so one burst isn't punished message after message.
    if (violation.rule === 'spam' || violation.rule === 'duplicates') tracker.forget(`${message.guildId}:${message.author.id}`);
    await enforce(message, violation, config.rules.get(violation.rule)!);
  },
});
