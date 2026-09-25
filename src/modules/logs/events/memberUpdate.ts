import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, nickChanged, roleDiff, rolesChanged } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.GuildMemberUpdate,
  async run(before: GuildMember | PartialGuildMember, after: GuildMember) {
    // Without the old member cached there's nothing to compare against.
    if (before.partial) return;
    const user = asLogUser(after.user);
    const guildId = after.guild.id;

    const { added, removed } = roleDiff(before.roles.cache.keys(), after.roles.cache.keys());
    if (added.length > 0 || removed.length > 0) {
      await postLog(after.client, guildId, 'roles', { embeds: [rolesChanged(user, added, removed)] });
    }
    if (before.nickname !== after.nickname) {
      await postLog(after.client, guildId, 'roles', { embeds: [nickChanged(user, before.nickname, after.nickname)] });
    }
  },
});
