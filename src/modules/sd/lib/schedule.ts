import type { Prisma } from '@prisma/client';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';

export const JOBS = {
  deadlineRemind: 'sd.deadline.remind',
  standupOpen: 'sd.standup.open',
  standupClose: 'sd.standup.close',
  meetingRemind: 'sd.meeting.remind',
  meetingNext: 'sd.meeting.next',
  digest: 'sd.digest',
} as const;

/**
 * Schedules a job unless one of the same type is already pending for this guild at the same time.
 * Recurring jobs schedule their successor before doing work, so a retry must not fork the chain.
 */
export async function scheduleOnce(
  type: string,
  runAt: Date,
  payload: unknown,
  guildId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number | null> {
  const existing = await db.job.findFirst({ where: { type, guildId, runAt, status: 'pending' } });
  if (existing) return null;
  return scheduleJob(type, runAt, payload, guildId, db);
}
