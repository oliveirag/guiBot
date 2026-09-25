import { EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { Cooldowns } from '../../../core/cooldowns.js';
import { ERROR_COLOR } from '../../../core/embeds.js';
import { log } from '../../../core/log.js';
import { postLog } from '../../logs/lib/routes.js';
import { punish } from '../../mod/lib/act.js';
import type { RuleConfig, Violation } from './engine.js';
import type { AutomodConfig } from './settings.js';

export const DEFAULT_TIMEOUT = 600;
const NOTICE_MS = 6_000;
// One punishment per person per burst; the rest of the burst just gets deleted.
const PUNISH_COOLDOWN = 15;

const punished = new Cooldowns();

export const AUTOMOD = (botId: string) => ({ id: botId, name: 'guiBot automod' });

/** Mods, exempt roles, and exempt channels (threads follow their parent) skip automod. */
export function isExempt(
  config: Pick<AutomodConfig, 'exemptRoles' | 'exemptChannels'>,
  member: Pick<GuildMember, 'permissions'> & { roles: { cache: { keys(): Iterable<string> } } },
  channelIds: readonly string[],
): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (channelIds.some((id) => config.exemptChannels.has(id))) return true;
  for (const roleId of member.roles.cache.keys()) if (config.exemptRoles.has(roleId)) return true;
  return false;
}

export function deletedEmbed(userId: string, channelId: string, violation: Violation, content: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle(`Automod · ${violation.rule}`)
    .setDescription(`<@${userId}> in <#${channelId}>\n**Why** ${violation.reason}`)
    .addFields({ name: 'Message', value: content.slice(0, 1024) || '*empty*' })
    .setTimestamp(new Date());
}

export async function enforce(message: Message<true>, violation: Violation, rule: RuleConfig): Promise<void> {
  const { guild, author, member } = message;
  if (message.deletable) await message.delete().catch(() => {});

  const notice = await message.channel
    .send({ content: `<@${author.id}> ${violation.reason.toLowerCase()}, so I removed that.`, allowedMentions: { users: [author.id] } })
    .catch(() => null);
  if (notice) setTimeout(() => void notice.delete().catch(() => {}), NOTICE_MS).unref();

  const firstInBurst = punished.hit(`${guild.id}:${author.id}`, PUNISH_COOLDOWN) === 0;
  if (rule.action === 'delete' || !firstInBurst) {
    await postLog(message.client, guild.id, 'modlog', {
      embeds: [deletedEmbed(author.id, message.channelId, violation, message.content)],
    }).catch((error) => log.warn('automod: log failed', error));
    return;
  }
  try {
    await punish({
      guild,
      target: author,
      member,
      moderator: AUTOMOD(message.client.user.id),
      action: rule.action,
      reason: `Automod: ${violation.reason}`,
      duration: rule.action === 'timeout' ? (rule.duration ?? DEFAULT_TIMEOUT) : null,
    });
  } catch (error) {
    log.warn(`automod: couldn't ${rule.action} ${author.id}`, error);
  }
}
