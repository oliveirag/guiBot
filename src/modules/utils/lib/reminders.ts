import type { Reminder } from '@prisma/client';
import { RESTJSONErrorCodes, type Client } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { sendTo } from '../../sd/lib/post.js';

export const JOB_REMIND = 'utils.remind';
export const MAX_ACTIVE = 25;
export const MAX_REMIND_SECONDS = 365 * 86_400;

const unix = (d: Date): number => Math.floor(d.getTime() / 1000);

export async function createReminder(input: {
  guildId: string;
  channelId: string;
  userId: string;
  text: string;
  dm: boolean;
  seconds: number;
  now?: Date;
}): Promise<Reminder> {
  if (input.seconds > MAX_REMIND_SECONDS) throw new UserError('Reminders max out at a year.');
  const active = await prisma.reminder.count({ where: { userId: input.userId } });
  if (active >= MAX_ACTIVE) throw new UserError(`You have ${MAX_ACTIVE} reminders going. Delete one with \`/remind delete\` first.`);
  const dueAt = new Date((input.now ?? new Date()).getTime() + input.seconds * 1000);
  return prisma.$transaction(async (tx) => {
    const { seconds: _, now: __, ...data } = input;
    const reminder = await tx.reminder.create({ data: { ...data, dueAt } });
    await scheduleJob(JOB_REMIND, dueAt, { reminderId: reminder.id }, input.guildId, tx);
    return reminder;
  });
}

export function listReminders(guildId: string, userId: string): Promise<Reminder[]> {
  return prisma.reminder.findMany({ where: { guildId, userId }, orderBy: { dueAt: 'asc' } });
}

export async function deleteReminder(guildId: string, userId: string, id: number): Promise<Reminder> {
  const found = await prisma.reminder.findFirst({ where: { id, guildId, userId } });
  if (!found) throw new UserError(`You don't have a reminder #${id} here.`);
  await prisma.reminder.delete({ where: { id } });
  return found;
}

export function reminderLine(r: Pick<Reminder, 'id' | 'text' | 'dueAt' | 'dm'>): string {
  const text = r.text.length > 80 ? `${r.text.slice(0, 79)}…` : r.text;
  return `**#${r.id}** <t:${unix(r.dueAt)}:R>${r.dm ? ' · DM' : ''} · ${text}`;
}

/** Sends a due reminder, then deletes it. Falls back to a DM when the channel is gone. False when it was cancelled. */
export async function deliverReminder(client: Client, reminderId: number): Promise<boolean> {
  const r = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!r) return false;
  const since = `-# set <t:${unix(r.createdAt)}:R>`;
  const posted =
    !r.dm &&
    (await sendTo(client, r.channelId, {
      content: `⏰ <@${r.userId}> ${r.text}\n${since}`,
      allowedMentions: { users: [r.userId] },
    }));
  if (!posted) {
    const guild = client.guilds.cache.get(r.guildId)?.name;
    try {
      await client.users.send(r.userId, { content: `⏰ ${r.text}\n-# set in ${guild ?? 'a server'} <t:${unix(r.createdAt)}:R>` });
    } catch (error) {
      // Closed DMs aren't going to open on a retry.
      if ((error as { code?: unknown }).code !== RESTJSONErrorCodes.CannotSendMessagesToThisUser) throw error;
      log.info(`utils: couldn't deliver reminder ${r.id}, DMs closed`);
    }
  }
  await prisma.reminder.deleteMany({ where: { id: r.id } });
  return true;
}
