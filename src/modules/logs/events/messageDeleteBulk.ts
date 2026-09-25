import { Events, type GuildTextBasedChannel, type ReadonlyCollection, type Message, type PartialMessage } from 'discord.js';
import { event } from '../../../core/define.js';
import { bulkDeleted } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.MessageBulkDelete,
  async run(messages: ReadonlyCollection<string, Message | PartialMessage>, channel: GuildTextBasedChannel) {
    await postLog(channel.client, channel.guildId, 'messages', { embeds: [bulkDeleted(channel.id, messages.size)] });
  },
});
