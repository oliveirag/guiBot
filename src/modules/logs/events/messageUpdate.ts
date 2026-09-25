import { Events, type Message, type PartialMessage } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, messageEdited } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.MessageUpdate,
  async run(before: Message | PartialMessage, after: Message | PartialMessage) {
    if (!after.guildId || after.partial || after.author.bot) return;
    const old = before.partial ? null : before.content;
    // Link previews and pins also fire updates; only real text edits count.
    if (old === after.content) return;
    const embed = messageEdited(asLogUser(after.author), after.channelId, after.url, old, after.content);
    await postLog(after.client, after.guildId, 'messages', { embeds: [embed] });
  },
});
