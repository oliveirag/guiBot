import { Events, type Message } from 'discord.js';
import { event } from '../../../core/define.js';
import { checkMessage } from '../lib/check.js';

export default event({
  name: Events.MessageCreate,
  async run(message: Message) {
    await checkMessage(message, false);
  },
});
