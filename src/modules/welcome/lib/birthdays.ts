import type { Prisma, WelcomeSettings } from '@prisma/client';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { scheduleOnce } from '../../sd/lib/schedule.js';
import { localParts, nextOccurrence, parseClock } from '../../sd/lib/time.js';

export const JOB_BIRTHDAYS = 'welcome.birthdays';
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface BirthdayPayload {
  version: number;
}

/** "10/5", "10-05", "Oct 5", "october 5th". Year is ignored if given. */
export function parseBirthday(raw: string): { month: number; day: number } {
  const text = raw.trim().toLowerCase();
  let month: number | undefined;
  let day: number | undefined;
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/.exec(text);
  const named = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+\d{4})?$/.exec(text);
  if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
  } else if (named) {
    const index = MONTHS.findIndex((m) => m.toLowerCase().startsWith(named[1]!.slice(0, 3)));
    if (index >= 0 && named[1]!.length >= 3) month = index + 1;
    day = Number(named[2]);
  }
  if (!month || !day || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]!) {
    throw new UserError(`I can't read "${raw}" as a birthday. Try 10/5 or Oct 5.`);
  }
  return { month, day };
}

export const formatBirthday = (b: { month: number; day: number }): string => `${MONTHS[b.month - 1]} ${b.day}`;

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Who to celebrate on this local date. Feb 29 birthdays show up on Feb 28 outside leap years. */
export function birthdaysOn(guildId: string, date: { year: number; month: number; day: number }) {
  const matches: Prisma.BirthdayWhereInput[] = [{ month: date.month, day: date.day }];
  if (date.month === 2 && date.day === 28 && !isLeap(date.year)) matches.push({ month: 2, day: 29 });
  return prisma.birthday.findMany({ where: { guildId, OR: matches } });
}

export async function scheduleNextBirthdays(settings: WelcomeSettings, after: Date, db: Prisma.TransactionClient = prisma) {
  if (!settings.birthdayChannelId) return null;
  const at = nextOccurrence(after, EVERY_DAY, parseClock(settings.birthdayTime), settings.timezone);
  if (!at) return null;
  const payload: BirthdayPayload = { version: settings.birthdayVersion };
  await scheduleOnce(JOB_BIRTHDAYS, at, payload, settings.guildId, db);
  return at;
}

/** Sorted by how soon they come up from `now` in the guild's timezone. */
export function sortUpcoming<T extends { month: number; day: number }>(rows: T[], now: Date, timeZone: string): T[] {
  const today = localParts(now, timeZone);
  const key = (b: { month: number; day: number }) => {
    const k = b.month * 100 + b.day;
    const t = today.month * 100 + today.day;
    return k >= t ? k - t : k - t + 1300;
  };
  return [...rows].sort((a, b) => key(a) - key(b));
}
