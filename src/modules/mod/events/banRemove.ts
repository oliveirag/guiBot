import { Events, type GuildBan } from 'discord.js';
import { event } from '../../../core/define.js';
import { deactivate } from '../lib/cases.js';

// Unbans done in Discord's UI stop any temp ban job from unbanning (and logging) again later.
export default event({
  name: Events.GuildBanRemove,
  async run(ban: GuildBan) {
    await deactivate(ban.guild.id, ban.user.id, 'ban');
  },
});
