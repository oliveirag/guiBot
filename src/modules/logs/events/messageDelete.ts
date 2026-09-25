import { Events, type Message, type PartialMessage } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, messageDeleted } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.MessageDelete,
  async run(message: Message | PartialMessage) {
    if (!message.guildId || message.author?.bot) return;
    const embed = messageDeleted({
      author: message.author ? asLogUser(message.author) : null,
      channelId: message.channelId,
      content: message.partial ? null : message.content || null,
      attachments: [...message.attachments.values()].map((a) => a.url),
      createdAt: message.createdAt ?? null,
    });
    await postLog(message.client, message.guildId, 'messages', { embeds: [embed] });
  },
});
