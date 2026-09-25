import { Events, type Message, type PartialMessage } from 'discord.js';
import { event } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { checkMessage } from '../lib/check.js';

export default event({
  name: Events.MessageUpdate,
  async run(before: Message | PartialMessage, after: Message | PartialMessage) {
    if (!after.guildId) return;
    // Link previews and pins also fire updates; only real text edits get re-checked.
    if (!before.partial && !after.partial && before.content === after.content) return;
    let message: Message;
    try {
      message = after.partial ? await after.fetch() : after;
    } catch (error) {
      log.warn('automod: could not fetch edited message', error);
      return;
    }
    if (!before.partial && before.content === message.content) return;
    await checkMessage(message, true);
  },
});
