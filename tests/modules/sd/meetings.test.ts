import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { log } from '../../../src/core/log.js';
import { prisma } from '../../../src/db.js';
import nextJob from '../../../src/modules/sd/jobs/meetingNext.js';
import remindJob from '../../../src/modules/sd/jobs/meetingRemind.js';
import {
  cancelMeeting,
  createMeeting,
  listUpcoming,
  publishMeeting,
  renderMeeting,
  rollWeekly,
  setRsvp,
  type MeetingInput,
} from '../../../src/modules/sd/lib/meetings.js';
import { JOBS } from '../../../src/modules/sd/lib/schedule.js';
import { resetDb } from '../../db.js';
import { embeds, fakeDiscord } from './fakes.js';

const now = new Date('2026-09-23T15:00:00Z');
const thursday7pm = new Date('2026-10-29T23:00:00Z'); // 19:00 EDT

const input = (extra: Partial<MeetingInput> = {}): MeetingInput => ({
  guildId: 'g1',
  channelId: 'c1',
  title: 'Sync',
  location: 'HEC 101',
  startsAt: thursday7pm,
  durationMin: 60,
  weekly: false,
  createdBy: 'u1',
  ...extra,
});

const jobsOf = (type: string) => prisma.job.findMany({ where: { type }, orderBy: { runAt: 'asc' } });

describe('meetings', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('queues reminders an hour and ten minutes out, plus next week for weekly ones', async () => {
    const meeting = await createMeeting(input({ weekly: true }), now);
    const reminders = await jobsOf(JOBS.meetingRemind);
    expect(reminders.map((j) => JSON.parse(j.payload).minutes)).toEqual([60, 10]);
    expect(reminders[1]!.runAt.toISOString()).toBe('2026-10-29T22:50:00.000Z');
    const [next] = await jobsOf(JOBS.meetingNext);
    expect(next).toMatchObject({ runAt: thursday7pm, guildId: 'g1' });
    expect(JSON.parse(next!.payload)).toEqual({ meetingId: meeting.id });
  });

  it('rejects past times, blank titles, and silly lengths', async () => {
    await expect(createMeeting(input({ startsAt: new Date(now.getTime() - 1) }), now)).rejects.toThrow(UserError);
    await expect(createMeeting(input({ title: ' ' }), now)).rejects.toThrow(UserError);
    await expect(createMeeting(input({ durationMin: 1 }), now)).rejects.toThrow(UserError);
  });

  it('posts RSVP buttons and a Discord event', async () => {
    const meeting = await createMeeting(input(), now);
    const { client, sent, events } = fakeDiscord();
    const published = await publishMeeting(client, meeting);
    expect(published).toMatchObject({ messageId: 'm100', eventId: 'e101' });
    expect(events[0]).toMatchObject({ name: 'Sync', entityMetadata: { location: 'HEC 101' } });
    const row = (sent[0]!.message.components![0] as { toJSON(): { components: { custom_id: string }[] } }).toJSON();
    expect(row.components.map((c) => c.custom_id)).toEqual([
      `sd:rsvp:${meeting.id}:yes`,
      `sd:rsvp:${meeting.id}:maybe`,
      `sd:rsvp:${meeting.id}:no`,
    ]);
  });

  it('still posts when the Discord event cannot be made', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    const meeting = await createMeeting(input(), now);
    const { client } = fakeDiscord();
    (client.guilds.fetch as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error('Missing Permissions'),
    );
    expect(await publishMeeting(client, meeting)).toMatchObject({ messageId: 'm100', eventId: null });
  });

  it('tracks RSVPs and shows them on the post', async () => {
    const meeting = await createMeeting(input(), now);
    await setRsvp(meeting.id, 'g1', 'u1', 'yes', now);
    await setRsvp(meeting.id, 'g1', 'u2', 'no', now);
    const withRsvps = await setRsvp(meeting.id, 'g1', 'u1', 'maybe', now);
    const fields = renderMeeting(withRsvps, withRsvps.rsvps).toJSON().fields!;
    expect(fields.map((f) => [f.name, f.value])).toEqual([
      ['Going (0)', '-'],
      ['Maybe (1)', '<@u1>'],
      ["Can't (1)", '<@u2>'],
    ]);
    await expect(setRsvp(meeting.id, 'g2', 'u1', 'yes', now)).rejects.toThrow(UserError);
    await expect(setRsvp(meeting.id, 'g1', 'u1', 'yes', new Date('2026-10-30T01:00:00Z'))).rejects.toThrow(
      /already happened/,
    );
  });

  it("pings going and maybe, not the people who can't make it", async () => {
    const meeting = await createMeeting(input(), now);
    await setRsvp(meeting.id, 'g1', 'u1', 'yes', now);
    await setRsvp(meeting.id, 'g1', 'u2', 'maybe', now);
    await setRsvp(meeting.id, 'g1', 'u3', 'no', now);
    const [job] = await jobsOf(JOBS.meetingRemind);
    const { client, sent } = fakeDiscord();
    await remindJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });
    expect(sent[0]!.message.content).toBe('<@u1> <@u2>');
    expect(sent[0]!.message.allowedMentions).toEqual({ users: ['u1', 'u2'] });
    expect(embeds(sent[0]!.message)[0]!.description).toContain('HEC 101');
  });

  it('cancels (creator or manager only), retires the post, and silences reminders', async () => {
    const meeting = await publishMeeting(fakeDiscord().client, await createMeeting(input(), now));
    const { client, edits, sent, deletedEvents } = fakeDiscord();
    await expect(cancelMeeting(client, 'g1', meeting!.id, 'u2', false, now)).rejects.toThrow(/Only whoever/);
    await cancelMeeting(client, 'g1', meeting!.id, 'u2', true, now);
    expect(edits[0]!.edit.components).toEqual([]);
    expect(embeds(edits[0]!.edit)[0]!.description).toContain('Cancelled');
    expect(deletedEvents).toEqual([meeting!.eventId]);
    await expect(cancelMeeting(client, 'g1', meeting!.id, 'u1', false, now)).rejects.toThrow(/already cancelled/);

    const [job] = await jobsOf(JOBS.meetingRemind);
    await remindJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });
    expect(sent).toEqual([]);
    expect(await listUpcoming('g1', now)).toEqual([]);
  });

  it('rolls a weekly meeting to the same local time next week, once', async () => {
    const meeting = await createMeeting(input({ weekly: true }), now);
    const { client, sent } = fakeDiscord();
    const [job] = await jobsOf(JOBS.meetingNext);
    await nextJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });
    await nextJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });

    const copies = await prisma.sdMeeting.findMany({ where: { id: { not: meeting.id } } });
    expect(copies).toHaveLength(1);
    // Clocks fall back on Nov 1, so 19:00 local is 00:00Z instead of 23:00Z.
    expect(copies[0]).toMatchObject({ startsAt: new Date('2026-11-06T00:00:00Z'), weekly: true, messageId: 'm100' });
    expect(sent).toHaveLength(1);
    expect(await jobsOf(JOBS.meetingNext)).toHaveLength(2);
  });

  it("doesn't roll a cancelled or one-off meeting", async () => {
    const once = await createMeeting(input(), now);
    const weekly = await createMeeting(input({ weekly: true, title: 'Weekly' }), now);
    await prisma.sdMeeting.update({ where: { id: weekly.id }, data: { cancelledAt: now } });
    const { client } = fakeDiscord();
    expect(await rollWeekly(client, once.id, 'America/New_York', now)).toBeNull();
    expect(await rollWeekly(client, weekly.id, 'America/New_York', now)).toBeNull();
  });
});
