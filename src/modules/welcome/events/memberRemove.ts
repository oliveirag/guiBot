import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { sendTo } from '../../sd/lib/post.js';
import { DEFAULT_LEAVE, getWelcome, greeting } from '../lib/greet.js';

export default event({
  name: Events.GuildMemberRemove,
  async run(member: GuildMember | PartialGuildMember) {
    if (member.user.bot) return;
    const s = await getWelcome(member.guild.id);
    if (!s?.leaveChannelId) return;
    const vars = { userId: member.id, username: member.user.username, server: member.guild.name, count: member.guild.memberCount };
    const message = greeting(s.leaveMessage ?? DEFAULT_LEAVE, vars, s.leaveEmbed, member.user.displayAvatarURL());
    // They're gone, so don't ping them.
    await sendTo(member.client, s.leaveChannelId, { ...message, allowedMentions: { parse: [] } });
  },
});
