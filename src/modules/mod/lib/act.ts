import type { ModCase } from '@prisma/client';
import { EmbedBuilder, RESTJSONErrorCodes, type Client, type Guild, type GuildMember, type User } from 'discord.js';
import { ERROR_COLOR } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { postLog } from '../../logs/lib/routes.js';
import { activeWarns, attachLog, createCase, deactivate, renderCase, type CaseAction } from './cases.js';
import { MAX_TIMEOUT_SECONDS } from './checks.js';
import { formatDuration } from './duration.js';
import { escalationFor, getModSettings } from './settings.js';

export const JOB_UNBAN = 'mod.unban';
export const DEFAULT_ESCALATION_TIMEOUT = 3600;

export type Punishment = 'warn' | 'timeout' | 'kick' | 'ban';

// "<guild>:<user>" for bans guiBot is making right now. The ban event can land before the case is saved.
export const botBans = new Set<string>();

const VERB: Record<Punishment, string> = { warn: 'warned', timeout: 'timed out', kick: 'kicked', ban: 'banned' };

export interface PunishInput {
  guild: Guild;
  target: User;
  member: GuildMember | null;
  moderator: { id: string; name: string };
  action: Punishment;
  reason: string | null;
  /** Seconds. Required for timeouts, makes bans temporary. */
  duration?: number | null;
  deleteMessageSeconds?: number;
}

export interface PunishResult {
  case: ModCase;
  escalated: ModCase | null;
  /** Null when DMs are turned off. */
  dmed: boolean | null;
}

const auditReason = (moderator: { name: string }, reason: string | null): string =>
  `${moderator.name}: ${reason ?? 'no reason'}`.slice(0, 512);

export function dmEmbed(guildName: string, action: Punishment, reason: string | null, duration: number | null): EmbedBuilder {
  const lines = [`**Reason** ${reason ?? 'No reason given'}`];
  if (duration) lines.push(`**Duration** ${formatDuration(duration)}`);
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle(`You were ${VERB[action]} in ${guildName}`)
    .setDescription(lines.join('\n'));
}

async function dm(user: User, embed: EmbedBuilder): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    // DMs closed or no shared server. Not worth failing the action over.
    return false;
  }
}

/** Posts the case to the modlog channel and remembers where. */
export async function announce(client: Client, c: ModCase): Promise<void> {
  try {
    const message = await postLog(client, c.guildId, 'modlog', { embeds: [renderCase(c)] });
    if (message) await attachLog(c.id, message.channelId, message.id);
  } catch (error) {
    log.warn(`mod: couldn't log case #${c.number}`, error);
  }
}

/** Warns, times out, kicks, or bans someone: DMs them, acts, records a case, logs it, and escalates warns. */
export async function punish(input: PunishInput): Promise<PunishResult> {
  const { guild, target, member, moderator, action, reason } = input;
  const duration = input.duration ?? null;
  if (action === 'timeout' && (!duration || duration > MAX_TIMEOUT_SECONDS)) {
    throw new UserError('Timeouts need a duration of 28 days or less.');
  }
  if ((action === 'kick' || action === 'timeout') && !member) throw new UserError("They're not in this server.");

  const settings = await getModSettings(guild.id);
  // DM first: after a kick or ban there's no shared server to DM through.
  const dmed = settings.dmOnAction ? await dm(target, dmEmbed(guild.name, action, reason, duration)) : null;

  const audit = auditReason(moderator, reason);
  if (action === 'ban') {
    const key = `${guild.id}:${target.id}`;
    botBans.add(key);
    setTimeout(() => botBans.delete(key), 30_000).unref();
    await guild.members.ban(target.id, { reason: audit, deleteMessageSeconds: input.deleteMessageSeconds ?? 0 });
  } else if (action === 'kick') {
    await member!.kick(audit);
  } else if (action === 'timeout') {
    await member!.timeout(duration! * 1000, audit);
  }

  // A new ban or timeout replaces the old one, so its expiry job stands down.
  if (action === 'ban' || action === 'timeout') await deactivate(guild.id, target.id, action);
  const c = await createCase({
    guildId: guild.id,
    action,
    userId: target.id,
    userTag: target.tag,
    moderatorId: moderator.id,
    reason,
    duration,
  });
  if (action === 'ban' && c.expiresAt) await scheduleJob(JOB_UNBAN, c.expiresAt, { caseId: c.id }, guild.id);
  await announce(guild.client, c);

  let escalated: ModCase | null = null;
  if (action === 'warn') {
    const count = (await activeWarns(guild.id, target.id)).length;
    const next = escalationFor(settings, count);
    if (next) {
      try {
        const result = await punish({
          ...input,
          moderator: { id: guild.client.user.id, name: 'guiBot' },
          action: next.action,
          reason: `Reached ${count} warnings`,
          duration: next.action === 'timeout' ? (next.duration ?? DEFAULT_ESCALATION_TIMEOUT) : next.duration,
        });
        escalated = result.case;
      } catch (error) {
        log.warn(`mod: escalation after warn #${c.number} failed`, error);
      }
    }
  }
  return { case: c, escalated, dmed };
}

export interface RevokeInput {
  guild: Guild;
  userId: string;
  userTag: string | null;
  member: GuildMember | null;
  moderator: { id: string; name: string };
  action: Extract<CaseAction, 'unban' | 'untimeout'>;
  reason: string | null;
}

/** Unbans or lifts a timeout, and records it. */
export async function revoke(input: RevokeInput): Promise<ModCase> {
  const { guild, userId, member, moderator, action, reason } = input;
  const audit = auditReason(moderator, reason);
  if (action === 'unban') {
    try {
      await guild.bans.remove(userId, audit);
    } catch (error) {
      if ((error as { code?: unknown }).code === RESTJSONErrorCodes.UnknownBan) throw new UserError("They aren't banned.");
      throw error;
    }
    await deactivate(guild.id, userId, 'ban');
  } else {
    if (!member) throw new UserError("They're not in this server.");
    if (!member.isCommunicationDisabled()) throw new UserError("They aren't timed out.");
    await member.timeout(null, audit);
    await deactivate(guild.id, userId, 'timeout');
  }
  const c = await createCase({ guildId: guild.id, action, userId, userTag: input.userTag, moderatorId: moderator.id, reason });
  await announce(guild.client, c);
  return c;
}
