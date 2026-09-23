import { UserError } from '../../../core/errors.js';

export const DEFAULT_TIMEZONE = 'America/New_York';

export interface LocalParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

export interface Clock {
  hour: number;
  minute: number;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_NAMES.indexOf((parts.weekday ?? '').toLowerCase()),
  };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(instant / 60_000) * 60_000;
}

/** The instant a wall-clock time happens in a zone. Times skipped by DST land an hour later. */
export function zonedTime(date: CalendarDate, clock: Clock, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, clock.hour, clock.minute);
  const first = wall - offsetMs(wall, timeZone);
  const second = wall - offsetMs(first, timeZone);
  const p = localParts(new Date(second), timeZone);
  // Only a time that doesn't exist (spring forward) fails to round-trip; `first` is the hour after it.
  return new Date(p.hour === clock.hour && p.minute === clock.minute ? second : first);
}

/** Calendar date `days` after the given one (handles month and year rollover). */
export function addDays(date: CalendarDate, days: number): CalendarDate & { weekday: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** Local "YYYY-MM-DD". */
export function dayKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** First time after `from` that falls on one of `days` at `clock`, local to the zone. */
export function nextOccurrence(from: Date, days: readonly number[], clock: Clock, timeZone: string): Date | null {
  if (days.length === 0) return null;
  const today = localParts(from, timeZone);
  for (let i = 0; i <= 7; i++) {
    const date = addDays(today, i);
    if (!days.includes(date.weekday)) continue;
    const at = zonedTime(date, clock, timeZone);
    if (at.getTime() > from.getTime()) return at;
  }
  return null;
}

/** Same wall-clock time a week later, so weekly things don't drift across DST. */
export function sameTimeNextWeek(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedTime(addDays(p, 7), p, timeZone);
}

/** "17:00", "5pm", "5:30 pm", "9am". */
export function parseClock(raw: string): Clock {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) hour = -1;
      else hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    } else if (match[2] === undefined) {
      hour = -1;
    }
    if (hour >= 0 && hour <= 23 && minute <= 59) return { hour, minute };
  }
  throw new UserError(`I can't read "${raw}" as a time. Try 17:00 or 5pm.`);
}

export const formatClock = (clock: Clock): string =>
  `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;

/** "2026-10-05", "10/5", "10/5/2026". Month/day without a year means the next time that date comes around. */
export function parseDate(raw: string, now: Date, timeZone: string): CalendarDate {
  const text = raw.trim();
  let date: CalendarDate | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text);
  if (iso) {
    date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  } else if (us) {
    const today = localParts(now, timeZone);
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = us[3] ? Number(us[3].length === 2 ? `20${us[3]}` : us[3]) : today.year;
    if (!us[3] && (month < today.month || (month === today.month && day < today.day))) year++;
    date = { year, month, day };
  }
  if (date) {
    const check = addDays(date, 0);
    if (check.year === date.year && check.month === date.month && check.day === date.day) return date;
  }
  throw new UserError(`I can't read "${raw}" as a date. Try 2026-10-05 or 10/5.`);
}

/** "mon-fri", "weekdays", "daily", "mon,wed,fri", "tue thu". */
export function parseDays(raw: string): number[] {
  const text = raw.trim().toLowerCase();
  if (text === 'weekdays') return [1, 2, 3, 4, 5];
  if (text === 'daily' || text === 'every day' || text === 'everyday') return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  const index = (name: string): number => {
    const i = WEEKDAY_NAMES.indexOf(name.slice(0, 3));
    if (i < 0 || name.length < 3) throw new UserError(`"${name}" isn't a day. Use names like mon, tue, wed.`);
    return i;
  };
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.split('-');
    if (range.length === 2) {
      const start = index(range[0]!);
      const end = index(range[1]!);
      for (let i = start; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === end) break;
      }
    } else {
      days.add(index(part));
    }
  }
  if (days.size === 0) throw new UserError('Pick at least one day, like mon-fri.');
  return [...days].sort((a, b) => a - b);
}

export function formatDays(days: readonly number[]): string {
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5') return 'Mon-Fri';
  if (key === '0,1,2,3,4,5,6') return 'every day';
  return days.map((d) => WEEKDAY_LABELS[d]).join(', ');
}

export const csvDays = (csv: string): number[] =>
  csv
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((d) => d >= 0 && d <= 6);

export const weekdayLabel = (day: number): string => WEEKDAY_LABELS[day] ?? '?';

/** Discord timestamp markup; renders in each viewer's own timezone. */
export const stamp = (date: Date, style: 'F' | 'f' | 'R' | 't' | 'd' | 'D' = 'f'): string =>
  `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
