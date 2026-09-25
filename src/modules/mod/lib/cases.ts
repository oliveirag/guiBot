import type { ModCase, Prisma } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR, SUCCESS_COLOR } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { formatDuration } from './duration.js';

export const CASE_ACTIONS = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn'] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

export const ACTION_LABEL: Record<CaseAction, string> = {
  ban: 'Ban',
  unban: 'Unban',
  kick: 'Kick',
  timeout: 'Timeout',
  untimeout: 'Timeout removed',
  warn: 'Warn',
};

const ACTION_COLOR: Record<CaseAction, number> = {
  ban: ERROR_COLOR,
  unban: SUCCESS_COLOR,
  kick: ERROR_COLOR,
  timeout: BRAND_COLOR,
  untimeout: SUCCESS_COLOR,
  warn: BRAND_COLOR,
};

export interface NewCase {
  guildId: string;
  action: CaseAction;
  userId: string;
  userTag?: string | null;
  moderatorId: string;
  reason?: string | null;
  duration?: number | null;
}

export function createCase(c: NewCase, now = new Date()): Promise<ModCase> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.modCase.findFirst({ where: { guildId: c.guildId }, orderBy: { number: 'desc' } });
    return tx.modCase.create({
      data: {
        guildId: c.guildId,
        number: (last?.number ?? 0) + 1,
        action: c.action,
        userId: c.userId,
        userTag: c.userTag ?? null,
        moderatorId: c.moderatorId,
        reason: c.reason ?? null,
        duration: c.duration ?? null,
        expiresAt: c.duration ? new Date(now.getTime() + c.duration * 1000) : null,
      },
    });
  });
}

export async function getCase(guildId: string, number: number): Promise<ModCase> {
  const found = await prisma.modCase.findUnique({ where: { guildId_number: { guildId, number } } });
  if (!found) throw new UserError(`There's no case #${number}.`);
  return found;
}

export async function editReason(guildId: string, number: number, reason: string): Promise<ModCase> {
  await getCase(guildId, number);
  return prisma.modCase.update({ where: { guildId_number: { guildId, number } }, data: { reason } });
}

export function userCases(guildId: string, userId: string, take = 25): Promise<ModCase[]> {
  return prisma.modCase.findMany({ where: { guildId, userId }, orderBy: { number: 'desc' }, take });
}

export function activeWarns(guildId: string, userId: string): Promise<ModCase[]> {
  return prisma.modCase.findMany({
    where: { guildId, userId, action: 'warn', active: true },
    orderBy: { number: 'asc' },
  });
}

export async function deleteWarn(guildId: string, number: number): Promise<ModCase> {
  const c = await getCase(guildId, number);
  if (c.action !== 'warn') throw new UserError(`Case #${number} is a ${c.action}, not a warn.`);
  if (!c.active) throw new UserError(`Warn #${number} was already removed.`);
  return prisma.modCase.update({ where: { id: c.id }, data: { active: false } });
}

export async function clearWarns(guildId: string, userId: string): Promise<number> {
  const { count } = await prisma.modCase.updateMany({
    where: { guildId, userId, action: 'warn', active: true },
    data: { active: false },
  });
  return count;
}

/** Ends active bans or timeouts for someone, so expiry jobs know they were lifted early. */
export async function deactivate(guildId: string, userId: string, action: 'ban' | 'timeout', db: Prisma.TransactionClient = prisma) {
  await db.modCase.updateMany({ where: { guildId, userId, action, active: true }, data: { active: false } });
}

/** Whether a case like this was just made, so the ban event doesn't log the bot's own bans twice. */
export async function madeRecently(guildId: string, userId: string, action: CaseAction, withinMs = 30_000, now = new Date()) {
  const since = new Date(now.getTime() - withinMs);
  return (await prisma.modCase.count({ where: { guildId, userId, action, createdAt: { gte: since } } })) > 0;
}

export async function attachLog(id: number, channelId: string, messageId: string): Promise<void> {
  await prisma.modCase.update({ where: { id }, data: { logChannelId: channelId, logMessageId: messageId } });
}

export function caseLine(c: ModCase): string {
  const when = `<t:${Math.floor(c.createdAt.getTime() / 1000)}:d>`;
  const struck = c.action === 'warn' && !c.active;
  const dur = c.duration ? ` (${formatDuration(c.duration)})` : '';
  const line = `\`#${c.number}\` ${ACTION_LABEL[c.action as CaseAction] ?? c.action}${dur} · ${c.reason ?? 'no reason'} · ${when}`;
  return struck ? `~~${line}~~` : line;
}

export function renderCase(c: ModCase): EmbedBuilder {
  const action = c.action as CaseAction;
  const lines = [
    `**User** <@${c.userId}>${c.userTag ? ` (${c.userTag})` : ''}`,
    `**Moderator** <@${c.moderatorId}>`,
    `**Reason** ${c.reason ?? 'No reason given'}`,
  ];
  if (c.duration) lines.push(`**Duration** ${formatDuration(c.duration)}`);
  if (c.expiresAt) lines.push(`**Ends** <t:${Math.floor(c.expiresAt.getTime() / 1000)}:R>`);
  return new EmbedBuilder()
    .setColor(ACTION_COLOR[action] ?? BRAND_COLOR)
    .setTitle(`Case #${c.number} · ${ACTION_LABEL[action] ?? c.action}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `User ${c.userId}` })
    .setTimestamp(c.createdAt);
}
