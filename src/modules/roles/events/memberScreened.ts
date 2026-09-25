import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { giveAutoRoles } from '../lib/autoroles.js';

// Servers with membership screening: autoroles land once the rules are accepted.
export default event({
  name: Events.GuildMemberUpdate,
  async run(before: GuildMember | PartialGuildMember, after: GuildMember) {
    if (before.pending && !after.pending) await giveAutoRoles(after);
  },
});
