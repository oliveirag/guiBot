import { Events, type GuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { giveAutoRoles } from '../lib/autoroles.js';

export default event({
  name: Events.GuildMemberAdd,
  async run(member: GuildMember) {
    await giveAutoRoles(member);
  },
});
