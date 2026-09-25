import { Events, type GuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { sendTo } from '../../sd/lib/post.js';
import { DEFAULT_JOIN, getWelcome, greeting, renderTemplate } from '../lib/greet.js';

export default event({
  name: Events.GuildMemberAdd,
  async run(member: GuildMember) {
    if (member.user.bot) return;
    const s = await getWelcome(member.guild.id);
    if (!s) return;
    const vars = { userId: member.id, username: member.user.username, server: member.guild.name, count: member.guild.memberCount };

    if (s.joinChannelId) {
      await sendTo(member.client, s.joinChannelId, greeting(s.joinMessage ?? DEFAULT_JOIN, vars, s.joinEmbed, member.displayAvatarURL()));
    }
    if (s.dmMessage) {
      await member
        .send({ content: renderTemplate(s.dmMessage, vars).slice(0, 2000), allowedMentions: { parse: [] } })
        .catch((error) => log.info(`welcome: couldn't DM ${member.id}`, (error as Error).message));
    }
  },
});
