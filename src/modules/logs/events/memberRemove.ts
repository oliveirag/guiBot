import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, memberLeft } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.GuildMemberRemove,
  async run(member: GuildMember | PartialGuildMember) {
    const roles = member.partial ? [] : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.id);
    const embed = memberLeft(asLogUser(member.user), member.joinedAt, roles);
    await postLog(member.client, member.guild.id, 'members', { embeds: [embed] });
  },
});
