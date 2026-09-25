import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { prisma } from '../../../src/db.js';
import {
  JOB_BIRTHDAYS,
  birthdaysOn,
  formatBirthday,
  parseBirthday,
  scheduleNextBirthdays,
  sortUpcoming,
} from '../../../src/modules/welcome/lib/birthdays.js';
import { greeting, renderTemplate, updateWelcome } from '../../../src/modules/welcome/lib/greet.js';
import { resetDb } from '../../db.js';

const G = 'g1';
const vars = { userId: 'u1', username: 'ana', server: 'Blue', count: 42 };

beforeEach(resetDb);

describe('templates', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(renderTemplate('Hi {user} ({username}) in {server}, #{count} {nope}', vars)).toBe('Hi <@u1> (ana) in Blue, #42 {nope}');
  });

  it('only pings the new member, and pings above embeds', () => {
    const plain = greeting('yo {user} @everyone', vars, false);
    expect(plain).toMatchObject({ content: 'yo <@u1> @everyone', allowedMentions: { users: ['u1'] } });
    const embed = greeting('yo {user}', vars, true, 'https://a/b.png');
    expect(embed.content).toBe('<@u1>');
    expect((embed.embeds![0] as { toJSON(): { description: string; thumbnail?: { url: string } } }).toJSON()).toMatchObject({
      description: 'yo <@u1>',
      thumbnail: { url: 'https://a/b.png' },
    });
    expect(greeting('welcome {username}', vars, true).content).toBeUndefined();
  });
});

describe('birthdays', () => {
  it('parses common formats', () => {
    expect(parseBirthday('10/5')).toEqual({ month: 10, day: 5 });
    expect(parseBirthday('02-29')).toEqual({ month: 2, day: 29 });
    expect(parseBirthday('Oct 5th')).toEqual({ month: 10, day: 5 });
    expect(parseBirthday('september 12, 2004')).toEqual({ month: 9, day: 12 });
    expect(() => parseBirthday('2/30')).toThrow(UserError);
    expect(() => parseBirthday('someday')).toThrow(UserError);
    expect(formatBirthday({ month: 10, day: 5 })).toBe('October 5');
  });

  it('celebrates Feb 29 on Feb 28 outside leap years', async () => {
    await prisma.birthday.createMany({
      data: [
        { guildId: G, userId: 'leap', month: 2, day: 29 },
        { guildId: G, userId: 'plain', month: 2, day: 28 },
      ],
    });
    const ids = async (year: number, day: number) => (await birthdaysOn(G, { year, month: 2, day })).map((b) => b.userId).sort();
    expect(await ids(2027, 28)).toEqual(['leap', 'plain']);
    expect(await ids(2028, 28)).toEqual(['plain']);
    expect(await ids(2028, 29)).toEqual(['leap']);
  });

  it('sorts by how soon each comes up', () => {
    const now = new Date('2026-09-24T16:00:00Z');
    const rows = [
      { month: 1, day: 1 },
      { month: 9, day: 24 },
      { month: 12, day: 25 },
      { month: 9, day: 23 },
    ];
    expect(sortUpcoming(rows, now, 'America/New_York')).toEqual([
      { month: 9, day: 24 },
      { month: 12, day: 25 },
      { month: 1, day: 1 },
      { month: 9, day: 23 },
    ]);
  });

  it('schedules the next daily check only when a channel is set', async () => {
    const off = await updateWelcome(G, {});
    expect(await scheduleNextBirthdays(off, new Date())).toBeNull();
    const on = await updateWelcome(G, { birthdayChannelId: 'c', birthdayTime: '09:00', birthdayVersion: 3 });
    const at = await scheduleNextBirthdays(on, new Date('2026-09-24T12:00:00Z'));
    expect(at).toEqual(new Date('2026-09-24T13:00:00Z'));
    const job = await prisma.job.findFirst({ where: { type: JOB_BIRTHDAYS } });
    expect(JSON.parse(job!.payload)).toEqual({ version: 3 });
  });
});
