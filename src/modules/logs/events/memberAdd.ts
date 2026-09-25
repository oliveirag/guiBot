import { Events, type GuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, memberJoined } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.GuildMemberAdd,
  async run(member: GuildMember) {
    const embed = memberJoined(asLogUser(member.user), member.user.createdAt, member.guild.memberCount);
    await postLog(member.client, member.guild.id, 'members', { embeds: [embed] });
  },
});
