import type { SdDeadline } from '@prisma/client';
import type { Client, EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { editIn, sendTo } from './post.js';
import { JOBS } from './schedule.js';
import { getSettings, updateSettings } from './settings.js';
import { stamp } from './time.js';

export const REMINDER_DAYS = [7, 2, 1];
export const MAX_OPEN_DEADLINES = 50;
const DAY_MS = 86_400_000;
const BOARD_LINES = 20;

export interface ReminderPayload {
  deadlineId: number;
  days: number;
  /** ISO dueAt the reminder was scheduled for, so a changed deadline ignores old reminders. */
  dueAt: string;
}

export async function addDeadline(
  guildId: string,
  title: string,
  dueAt: Date,
  createdBy: string,
  now = new Date(),
): Promise<{ deadline: SdDeadline; reminders: number }> {
  const clean = title.trim();
  if (!clean) throw new UserError('Give the deadline a name.');
  if (dueAt.getTime() <= now.getTime()) throw new UserError("That's already in the past.");
  if ((await prisma.sdDeadline.count({ where: { guildId, doneAt: null } })) >= MAX_OPEN_DEADLINES) {
    throw new UserError(`There are already ${MAX_OPEN_DEADLINES} open deadlines. Close some first.`);
  }
  return prisma.$transaction(async (tx) => {
    const deadline = await tx.sdDeadline.create({ data: { guildId, title: clean.slice(0, 200), dueAt, createdBy } });
    let reminders = 0;
    for (const days of REMINDER_DAYS) {
      const at = new Date(dueAt.getTime() - days * DAY_MS);
      if (at.getTime() <= now.getTime()) continue;
      const payload: ReminderPayload = { deadlineId: deadline.id, days, dueAt: dueAt.toISOString() };
      await scheduleJob(JOBS.deadlineRemind, at, payload, guildId, tx);
      reminders++;
    }
    return { deadline, reminders };
  });
}

export function listOpen(guildId: string): Promise<SdDeadline[]> {
  return prisma.sdDeadline.findMany({ where: { guildId, doneAt: null }, orderBy: { dueAt: 'asc' } });
}

export function upcomingWithin(guildId: string, now: Date, days: number): Promise<SdDeadline[]> {
  return prisma.sdDeadline.findMany({
    where: { guildId, doneAt: null, dueAt: { lte: new Date(now.getTime() + days * DAY_MS) } },
    orderBy: { dueAt: 'asc' },
  });
}

export async function markDone(guildId: string, id: number, now = new Date()): Promise<SdDeadline> {
  const deadline = await prisma.sdDeadline.findFirst({ where: { id, guildId } });
  if (!deadline) throw new UserError(`No deadline #${id}. See \`/deadline list\`.`);
  if (deadline.doneAt) throw new UserError(`#${id} is already done.`);
  return prisma.sdDeadline.update({ where: { id }, data: { doneAt: now } });
}

export function deadlineLine(d: SdDeadline, now: Date): string {
  const overdue = d.dueAt.getTime() <= now.getTime() ? ' · **overdue**' : '';
  return `\`#${d.id}\` **${d.title}** · ${stamp(d.dueAt, 'f')} (${stamp(d.dueAt, 'R')})${overdue}`;
}

export function renderBoard(deadlines: SdDeadline[], now: Date): EmbedBuilder {
  if (deadlines.length === 0) return info('Nothing due. Add one with `/deadline add`.', 'Upcoming deadlines');
  const lines = deadlines.slice(0, BOARD_LINES).map((d) => deadlineLine(d, now));
  const hidden = deadlines.length - BOARD_LINES;
  if (hidden > 0) lines.push(`…and ${hidden} more`);
  return info(lines.join('\n'), 'Upcoming deadlines').setFooter({ text: 'Updates on its own · /deadline done <id>' });
}

export function renderReminder(d: SdDeadline, days: number): EmbedBuilder {
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  return info(`**${d.title}** is due ${when}, ${stamp(d.dueAt, 'f')}.`, 'Deadline coming up');
}

/** Edits the board in the deadlines channel, or posts a fresh one if it's gone. No-op without a channel. */
export async function refreshBoard(client: Client, guildId: string, now = new Date()): Promise<void> {
  const settings = await getSettings(guildId);
  if (!settings.deadlineChannelId) return;
  const embed = renderBoard(await listOpen(guildId), now);
  if (
    settings.boardMessageId &&
    (await editIn(client, settings.deadlineChannelId, settings.boardMessageId, { embeds: [embed] }))
  ) {
    return;
  }
  const message = await sendTo(client, settings.deadlineChannelId, { embeds: [embed] });
  if (message) await updateSettings(guildId, { boardMessageId: message.id });
}
