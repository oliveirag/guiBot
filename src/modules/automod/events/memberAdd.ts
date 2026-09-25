import { Events, type GuildMember } from 'discord.js';
import { event } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { postLog } from '../../logs/lib/routes.js';
import { punish } from '../../mod/lib/act.js';
import { RULE_INFO, tooNew } from '../lib/engine.js';
import { AUTOMOD, DEFAULT_TIMEOUT } from '../lib/enforce.js';
import { getAutomod } from '../lib/settings.js';
import { info } from '../../../core/embeds.js';

// The newaccount rule. Kick and timeout act on the account; delete and warn just flag it in the modlog.
export default event({
  name: Events.GuildMemberAdd,
  async run(member: GuildMember) {
    if (member.user.bot) return;
    const rule = (await getAutomod(member.guild.id)).rules.get('newaccount');
    if (!rule) return;
    const minDays = rule.limit ?? RULE_INFO.newaccount.limit!;
    if (!tooNew(member.user.createdAt, minDays)) return;

    const reason = `Automod: account is younger than ${minDays} day${minDays === 1 ? '' : 's'}`;
    if (rule.action === 'kick' || rule.action === 'timeout') {
      try {
        await punish({
          guild: member.guild,
          target: member.user,
          member,
          moderator: AUTOMOD(member.client.user.id),
          action: rule.action,
          reason,
          duration: rule.action === 'timeout' ? (rule.duration ?? DEFAULT_TIMEOUT) : null,
        });
      } catch (error) {
        log.warn(`automod: newaccount ${rule.action} failed`, error);
      }
      return;
    }
    await postLog(member.client, member.guild.id, 'modlog', {
      embeds: [info(`<@${member.id}> joined with an account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`, 'Automod · new account')],
    });
  },
});
