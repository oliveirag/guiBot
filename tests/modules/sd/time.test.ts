import { describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import {
  dayKey,
  formatDays,
  isValidTimeZone,
  nextOccurrence,
  parseClock,
  parseDate,
  parseDays,
  sameTimeNextWeek,
  zonedTime,
} from '../../../src/modules/sd/lib/time.js';

const NY = 'America/New_York';
const iso = (d: Date | null) => d?.toISOString();

describe('zonedTime', () => {
  it('converts wall-clock time in and out of daylight time', () => {
    expect(iso(zonedTime({ year: 2026, month: 9, day: 23 }, { hour: 10, minute: 0 }, NY))).toBe('2026-09-23T14:00:00.000Z');
    expect(iso(zonedTime({ year: 2026, month: 12, day: 1 }, { hour: 10, minute: 0 }, NY))).toBe('2026-12-01T15:00:00.000Z');
    expect(iso(zonedTime({ year: 2026, month: 9, day: 23 }, { hour: 10, minute: 0 }, 'UTC'))).toBe('2026-09-23T10:00:00.000Z');
  });

  it('moves a time skipped by spring forward to the hour after', () => {
    // 2:30am on 2026-03-08 doesn't exist in New York; 3:30 EDT is 07:30Z.
    expect(iso(zonedTime({ year: 2026, month: 3, day: 8 }, { hour: 2, minute: 30 }, NY))).toBe('2026-03-08T07:30:00.000Z');
  });
});

describe('nextOccurrence', () => {
  const weekdays = [1, 2, 3, 4, 5];
  const ten = { hour: 10, minute: 0 };

  it('picks later today when the time is still ahead', () => {
    expect(iso(nextOccurrence(new Date('2026-09-23T13:00:00Z'), weekdays, ten, NY))).toBe('2026-09-23T14:00:00.000Z');
  });

  it('skips to the next matching day once the time has passed', () => {
    expect(iso(nextOccurrence(new Date('2026-09-23T14:00:00Z'), weekdays, ten, NY))).toBe('2026-09-24T14:00:00.000Z');
  });

  it('skips the weekend', () => {
    expect(iso(nextOccurrence(new Date('2026-09-25T15:00:00Z'), weekdays, ten, NY))).toBe('2026-09-28T14:00:00.000Z');
  });

  it('goes a full week out for a single weekday that already passed', () => {
    expect(iso(nextOccurrence(new Date('2026-09-25T22:00:00Z'), [5], { hour: 17, minute: 0 }, NY))).toBe(
      '2026-10-02T21:00:00.000Z',
    );
  });

  it('returns null with no days', () => {
    expect(nextOccurrence(new Date(), [], ten, NY)).toBeNull();
  });
});

describe('sameTimeNextWeek', () => {
  it('keeps the local time across the fall back', () => {
    // Thu 10:00 EDT, then Thu 10:00 EST.
    expect(iso(sameTimeNextWeek(new Date('2026-10-29T14:00:00Z'), NY))).toBe('2026-11-05T15:00:00.000Z');
  });
});

describe('dayKey', () => {
  it('uses the local date, not UTC', () => {
    expect(dayKey(new Date('2026-09-24T02:00:00Z'), NY)).toBe('2026-09-23');
  });
});

describe('parseClock', () => {
  it('reads 24h and am/pm times', () => {
    expect(parseClock('17:00')).toEqual({ hour: 17, minute: 0 });
    expect(parseClock('9:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseClock('5pm')).toEqual({ hour: 17, minute: 0 });
    expect(parseClock('5:30 PM')).toEqual({ hour: 17, minute: 30 });
    expect(parseClock('12am')).toEqual({ hour: 0, minute: 0 });
    expect(parseClock('12pm')).toEqual({ hour: 12, minute: 0 });
  });

  it('rejects ambiguous or impossible times', () => {
    for (const raw of ['17', '13pm', '25:00', '10:75', 'noon']) expect(() => parseClock(raw), raw).toThrow(UserError);
  });
});

describe('parseDate', () => {
  const now = new Date('2026-09-23T15:00:00Z');

  it('reads ISO and month/day dates', () => {
    expect(parseDate('2026-10-05', now, NY)).toEqual({ year: 2026, month: 10, day: 5 });
    expect(parseDate('10/5', now, NY)).toEqual({ year: 2026, month: 10, day: 5 });
    expect(parseDate('10/5/27', now, NY)).toEqual({ year: 2027, month: 10, day: 5 });
  });

  it('rolls a month/day that already passed into next year, but not today', () => {
    expect(parseDate('1/5', now, NY)).toEqual({ year: 2027, month: 1, day: 5 });
    expect(parseDate('9/23', now, NY)).toEqual({ year: 2026, month: 9, day: 23 });
  });

  it('rejects dates that do not exist', () => {
    for (const raw of ['2026-02-30', '13/1', 'tomorrow']) expect(() => parseDate(raw, now, NY), raw).toThrow(UserError);
  });
});

describe('parseDays', () => {
  it('reads ranges, lists, and shorthands', () => {
    expect(parseDays('mon-fri')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('Tue, Thursday')).toEqual([2, 4]);
    expect(parseDays('fri-mon')).toEqual([0, 1, 5, 6]);
    expect(parseDays('weekdays')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('daily')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('rejects things that are not days', () => {
    expect(() => parseDays('funday')).toThrow(UserError);
    expect(() => parseDays('')).toThrow(UserError);
  });

  it('formats back to something short', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon-Fri');
    expect(formatDays([1, 3, 5])).toBe('Mon, Wed, Fri');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names only', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
