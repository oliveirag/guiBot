import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { prisma } from '../../../src/db.js';
import remind from '../../../src/modules/sd/jobs/deadlineRemind.js';
import {
  MAX_OPEN_DEADLINES,
  addDeadline,
  listOpen,
  markDone,
  refreshBoard,
  renderBoard,
} from '../../../src/modules/sd/lib/deadlines.js';
import { JOBS } from '../../../src/modules/sd/lib/schedule.js';
import { getSettings, updateSettings } from '../../../src/modules/sd/lib/settings.js';
import { resetDb } from '../../db.js';
import { apiError, embeds, fakeDiscord } from './fakes.js';

const DAY = 86_400_000;
const now = new Date('2026-09-23T15:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * DAY);

const reminderJobs = () => prisma.job.findMany({ where: { type: JOBS.deadlineRemind }, orderBy: { runAt: 'asc' } });

describe('addDeadline', () => {
  beforeEach(resetDb);

  it('queues reminders 7, 2, and 1 day out', async () => {
    const { deadline, reminders } = await addDeadline('g1', ' Design doc ', inDays(10), 'u1', now);
    expect(deadline.title).toBe('Design doc');
    expect(reminders).toBe(3);
    const jobs = await reminderJobs();
    expect(jobs.map((j) => j.runAt.toISOString())).toEqual([inDays(3), inDays(8), inDays(9)].map((d) => d.toISOString()));
    expect(JSON.parse(jobs[0]!.payload)).toEqual({ deadlineId: deadline.id, days: 7, dueAt: inDays(10).toISOString() });
    expect(jobs.every((j) => j.guildId === 'g1')).toBe(true);
  });

  it('skips reminders that would already be in the past', async () => {
    const { reminders } = await addDeadline('g1', 'Soon', inDays(1.5), 'u1', now);
    expect(reminders).toBe(1);
    expect((await reminderJobs()).map((j) => JSON.parse(j.payload).days)).toEqual([1]);
  });

  it('rejects past dates, blank titles, and too many open deadlines', async () => {
    await expect(addDeadline('g1', 'Late', inDays(-1), 'u1', now)).rejects.toThrow(UserError);
    await expect(addDeadline('g1', '  ', inDays(3), 'u1', now)).rejects.toThrow(UserError);
    await prisma.sdDeadline.createMany({
      data: Array.from({ length: MAX_OPEN_DEADLINES }, (_, i) => ({
        guildId: 'g1',
        title: `d${i}`,
        dueAt: inDays(5),
        createdBy: 'u1',
      })),
    });
    await expect(addDeadline('g1', 'One more', inDays(3), 'u1', now)).rejects.toThrow(/already/);
  });
});

describe('markDone and the board', () => {
  beforeEach(resetDb);

  it('marks done once, only in its own server', async () => {
    const { deadline } = await addDeadline('g1', 'Doc', inDays(3), 'u1', now);
    await expect(markDone('g2', deadline.id, now)).rejects.toThrow(UserError);
    await markDone('g1', deadline.id, now);
    await expect(markDone('g1', deadline.id, now)).rejects.toThrow(/already done/);
    expect(await listOpen('g1')).toEqual([]);
  });

  it('renders open deadlines soonest first and flags overdue ones', async () => {
    await addDeadline('g1', 'Later', inDays(9), 'u1', now);
    await addDeadline('g1', 'Sooner', inDays(2), 'u1', now);
    const text = renderBoard(await listOpen('g1'), inDays(4)).toJSON().description!;
    expect(text.indexOf('Sooner')).toBeLessThan(text.indexOf('Later'));
    expect(text).toMatch(/Sooner.*overdue/);
    expect(text).not.toMatch(/Later.*overdue/);
    expect(renderBoard([], now).toJSON().description).toMatch(/Nothing due/);
  });

  it('posts the board once, then edits it in place', async () => {
    const { client, sent, edits } = fakeDiscord();
    await refreshBoard(client, 'g1', now);
    expect(sent).toEqual([]);

    await updateSettings('g1', { deadlineChannelId: 'c1' });
    await addDeadline('g1', 'Doc', inDays(3), 'u1', now);
    await refreshBoard(client, 'g1', now);
    expect(sent).toHaveLength(1);
    expect((await getSettings('g1')).boardMessageId).toBe('m100');

    await refreshBoard(client, 'g1', now);
    expect(sent).toHaveLength(1);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ channelId: 'c1', messageId: 'm100' });
  });

  it('posts a new board when the old message is gone', async () => {
    await updateSettings('g1', { deadlineChannelId: 'c1', boardMessageId: 'gone' });
    const { client, sent } = fakeDiscord();
    (client.channels.fetch as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      isTextBased: () => true,
      messages: {
        fetch: async () => {
          throw apiError(10008);
        },
      },
    });
    await refreshBoard(client, 'g1', now);
    expect(sent).toHaveLength(1);
    expect((await getSettings('g1')).boardMessageId).toBe('m100');
  });
});

describe('deadline reminder job', () => {
  beforeEach(resetDb);

  const run = async (client: ReturnType<typeof fakeDiscord>['client']) => {
    const job = (await reminderJobs())[0]!;
    await remind.run(JSON.parse(job.payload), { id: job.id, guildId: 'g1', client });
  };

  it('posts the reminder and refreshes the board', async () => {
    await updateSettings('g1', { deadlineChannelId: 'c1' });
    await addDeadline('g1', 'Design doc', inDays(10), 'u1', now);
    const { client, sent } = fakeDiscord();
    await run(client);
    expect(sent).toHaveLength(2);
    expect(embeds(sent[0]!.message)[0]!.description).toMatch(/Design doc.*in 7 days/);
    expect(embeds(sent[1]!.message)[0]!.title).toBe('Upcoming deadlines');
  });

  it('stays quiet without a channel, for moved deadlines, and for done ones', async () => {
    const { deadline } = await addDeadline('g1', 'Doc', inDays(10), 'u1', now);
    const { client, sent } = fakeDiscord();
    await run(client);
    expect(sent).toEqual([]);

    await updateSettings('g1', { deadlineChannelId: 'c1' });
    await prisma.sdDeadline.update({ where: { id: deadline.id }, data: { dueAt: inDays(12) } });
    await run(client);
    expect(sent).toEqual([]);

    await prisma.sdDeadline.update({ where: { id: deadline.id }, data: { dueAt: inDays(10), doneAt: now } });
    await run(client);
    expect(sent).toEqual([]);
  });
});
