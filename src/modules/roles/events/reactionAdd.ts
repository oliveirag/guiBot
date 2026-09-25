import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import { event } from '../../../core/define.js';
import { applyReaction } from '../lib/reactions.js';

export default event({
  name: Events.MessageReactionAdd,
  async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    await applyReaction(reaction, user, true);
  },
});
