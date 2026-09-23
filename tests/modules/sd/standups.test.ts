import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { prisma } from '../../../src/db.js';
import openJob from '../../../src/modules/sd/jobs/standupOpen.js';
import { JOBS } from '../../../src/modules/sd/lib/schedule.js';
import { getSettings } from '../../../src/modules/sd/lib/settings.js';
import {
  closeStandup,
  configureStandup,
  disableStandup,
  hasBlocker,
  openStandup,
  standupModal,
  submitEntry,
} from '../../../src/modules/sd/lib/standups.js';
import { linkMember } from '../../../src/modules/sd/lib/team.js';
import { resetDb } from '../../db.js';
import { apiError, embeds, fakeDiscord } from './fakes.js';

const wedMorning = new Date('2026-09-23T13:00:00Z'); // 09:00 in New York
const config = { channelId: 'c1', clock: { hour: 10, minute: 0 }, days: [1, 2, 3, 4, 5], windowHours: 4 };

const jobsOf = (type: string) => prisma.job.findMany({ where: { type, status: 'pending' }, orderBy: { runAt: 'asc' } });

describe('standup schedule', () => {
  beforeEach(resetDb);

  it('queues the next standup with the current version', async () => {
    const at = await configureStandup('g1', config, wedMorning);
    expect(at?.toISOString()).toBe('2026-09-23T14:00:00.000Z');
    const [job] = await jobsOf(JOBS.standupOpen);
    expect(job).toMatchObject({ guildId: 'g1', runAt: at });
    expect(JSON.parse(job!.payload)).toEqual({ version: 1 });
    expect(await getSettings('g1')).toMatchObject({ standupChannelId: 'c1', standupTime: '10:00', standupDays: '1,2,3,4,5' });
  });

  it('rejects a summary delay outside 1 to 12 hours', () => {
    expect(() => configureStandup('g1', { ...config, windowHours: 0 })).toThrow(UserError);
  });

  it('makes jobs from an old schedule do nothing', async () => {
    await configureStandup('g1', config, wedMorning);
    const [old] = await jobsOf(JOBS.standupOpen);
    await configureStandup('g1', { ...config, clock: { hour: 11, minute: 0 } }, wedMorning);

    const { client, sent } = fakeDiscord();
    await openJob.run(JSON.parse(old!.payload), { id: old!.id, guildId: 'g1', client });
    expect(sent).toEqual([]);
    // The stale job didn't queue a successor; only the two configure calls did.
    expect((await jobsOf(JOBS.standupOpen)).map((j) => JSON.parse(j.payload).version)).toEqual([1, 2]);
  });

  it('opens the standup and queues the next one when the job runs', async () => {
    await configureStandup('g1', config, wedMorning);
    const [job] = await jobsOf(JOBS.standupOpen);
    const { client, sent } = fakeDiscord();
    await openJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe('c1');
    expect(embeds(sent[0]!.message)[0]!.title).toMatch(/^Standup · \d{4}-\d{2}-\d{2}$/);
    const next = (await jobsOf(JOBS.standupOpen)).filter((j) => j.id !== job!.id);
    expect(next).toHaveLength(1);
    expect(next[0]!.runAt.getTime()).toBeGreaterThan(Date.now());

    // A retry of the same job doesn't fork the chain or post twice.
    await openJob.run(JSON.parse(job!.payload), { id: job!.id, guildId: 'g1', client });
    expect(sent).toHaveLength(1);
    expect((await jobsOf(JOBS.standupOpen)).filter((j) => j.id !== job!.id)).toHaveLength(1);
  });

  it('turns off', async () => {
    await configureStandup('g1', config, wedMorning);
    await disableStandup('g1');
    expect(await getSettings('g1')).toMatchObject({ standupChannelId: null, standupVersion: 2 });
  });
});

describe('running a standup', () => {
  beforeEach(async () => {
    await resetDb();
    await configureStandup('g1', config, wedMorning);
  });

  it('opens once per day with a button, and queues the summary', async () => {
    const { client, sent } = fakeDiscord();
    const first = await openStandup(client, 'g1', wedMorning);
    expect(first.posted).toBe(true);
    expect(first.standup).toMatchObject({ day: '2026-09-23', messageId: 'm100', channelId: 'c1' });
    const row = (sent[0]!.message.components![0] as { toJSON(): { components: { custom_id: string }[] } }).toJSON();
    expect(row.components[0]!.custom_id).toBe(`sd:standup:${first.standup.id}`);
    const [close] = await jobsOf(JOBS.standupClose);
    expect(close!.runAt.toISOString()).toBe('2026-09-23T17:00:00.000Z');

    const again = await openStandup(client, 'g1', wedMorning);
    expect(again.posted).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('posts later if the first send could not go out', async () => {
    const broken = fakeDiscord({ c1: apiError(50001) });
    expect((await openStandup(broken.client, 'g1', wedMorning)).posted).toBe(false);
    const { client, sent } = fakeDiscord();
    expect((await openStandup(client, 'g1', wedMorning)).posted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(await jobsOf(JOBS.standupClose)).toHaveLength(1);
  });

  it('needs a channel', async () => {
    await disableStandup('g1');
    await expect(openStandup(fakeDiscord().client, 'g1', wedMorning)).rejects.toThrow(/config sd standup/);
  });

  it('saves and updates entries, and refuses them after closing', async () => {
    const { client } = fakeDiscord();
    const { standup } = await openStandup(client, 'g1', wedMorning);
    await submitEntry(standup.id, 'g1', 'u1', { yesterday: 'auth', today: 'tests', blockers: null });
    const updated = await submitEntry(standup.id, 'g1', 'u1', { yesterday: 'auth', today: 'more tests', blockers: ' ' });
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]).toMatchObject({ today: 'more tests', blockers: null });

    const entry = { yesterday: 'a', today: 'b', blockers: null };
    await expect(submitEntry(standup.id, 'g2', 'u1', entry)).rejects.toThrow(UserError);
    await expect(submitEntry(standup.id, 'g1', 'u2', { ...entry, yesterday: ' ' })).rejects.toThrow(UserError);
    await closeStandup(client, standup.id, wedMorning);
    await expect(submitEntry(standup.id, 'g1', 'u2', entry)).rejects.toThrow(/closed/);
  });

  it('summarizes who posted, who is missing, and who is blocked, then retires the button', async () => {
    for (const u of ['u1', 'u2', 'u3']) await linkMember('g1', u, { githubLogin: `gh-${u}` });
    const { client, sent, edits } = fakeDiscord();
    const { standup } = await openStandup(client, 'g1', wedMorning);
    await submitEntry(standup.id, 'g1', 'u1', { yesterday: 'auth', today: 'tests', blockers: 'none' });
    await submitEntry(standup.id, 'g1', 'u2', { yesterday: 'ui', today: 'ui', blockers: 'waiting on API keys' });

    expect(await closeStandup(client, standup.id, wedMorning)).toBe(true);
    const summary = embeds(sent[1]!.message);
    expect(summary[0]!.title).toBe('Standup summary · 2026-09-23');
    const text = summary.map((e) => e.description).join('\n');
    expect(text).toContain('**2** of 3 posted.');
    expect(text).toContain('**Missing** <@u3>');
    expect(text).toContain('**Blocked** <@u2>');
    expect(text).toContain('waiting on API keys');
    expect(text).not.toContain('**Blocker** none');
    expect(sent[1]!.message.allowedMentions).toEqual({ parse: [] });
    expect(edits.at(-1)!.edit.components).toEqual([]);

    expect(await closeStandup(client, standup.id, wedMorning)).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('stays open when the summary fails for a reason that might pass', async () => {
    const { client } = fakeDiscord();
    const { standup } = await openStandup(client, 'g1', wedMorning);
    const flaky = fakeDiscord({ c1: new Error('socket hang up') });
    await expect(closeStandup(flaky.client, standup.id, wedMorning)).rejects.toThrow('socket hang up');
    expect((await prisma.sdStandup.findUnique({ where: { id: standup.id } }))!.closedAt).toBeNull();
  });
});

describe('standup helpers', () => {
  it('treats "none" and friends as no blocker', () => {
    for (const b of ['none', 'None.', 'n/a', 'nope', '-', '', null]) {
      expect(hasBlocker({ blockers: b }), String(b)).toBe(false);
    }
    expect(hasBlocker({ blockers: 'need a design review' })).toBe(true);
  });

  it('prefills the modal with an earlier answer', () => {
    const json = standupModal(7, {
      standupId: 7,
      userId: 'u1',
      yesterday: 'did',
      today: 'doing',
      blockers: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).toJSON();
    expect(json.custom_id).toBe('sd:standup-modal:7');
    expect(JSON.stringify(json)).toContain('"value":"did"');
  });
});
