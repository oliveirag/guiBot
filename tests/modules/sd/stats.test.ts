import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import digestJob from '../../../src/modules/sd/jobs/digest.js';
import { addDeadline } from '../../../src/modules/sd/lib/deadlines.js';
import { buildDigest, configureDigest, disableDigest } from '../../../src/modules/sd/lib/digest.js';
import { JOBS } from '../../../src/modules/sd/lib/schedule.js';
import { activity, renderMemberProgress, renderTeamProgress, standupRecords } from '../../../src/modules/sd/lib/stats.js';
import { linkMember, listMembers } from '../../../src/modules/sd/lib/team.js';
import { resetDb } from '../../db.js';
import { embeds, fakeDiscord } from './fakes.js';

const DAY = 86_400_000;
const now = new Date('2026-09-23T15:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

let seq = 0;
function devEvent(
  source: 'github' | 'jira',
  key: string,
  kind: string,
  actor: string,
  extra: { count?: number; at?: Date } = {},
) {
  return prisma.devEvent.create({
    data: {
      deliveryId: `${source}:t${seq++}#0`,
      source,
      kind,
      key,
      actor,
      actorName: actor,
      title: 't',
      count: extra.count ?? null,
      createdAt: extra.at ?? daysAgo(1),
    },
  });
}

async function seedTeam() {
  await addFeed('g1', 'github', 'sducf/zaklang', 'c1');
  await addFeed('g1', 'jira', 'SD', 'c1');
  await linkMember('g1', 'u1', { githubLogin: 'gui', jiraAccountId: 'acc-1' });
  await linkMember('g1', 'u2', { githubLogin: 'ana' });
  await linkMember('g1', 'u3', {});
}

async function seedEvents() {
  await devEvent('github', 'sducf/zaklang', 'push.default', 'Gui', { count: 3 });
  await devEvent('github', 'sducf/zaklang', 'push', 'gui', { count: 2 });
  await devEvent('github', 'sducf/zaklang', 'pr.opened', 'gui');
  await devEvent('github', 'sducf/zaklang', 'pr.merged', 'gui');
  await devEvent('github', 'sducf/zaklang', 'pr.approved', 'ana');
  await devEvent('github', 'sducf/zaklang', 'pr.changes_requested', 'ana');
  await devEvent('github', 'sducf/zaklang', 'workflow.failed', 'gui');
  await devEvent('github', 'sducf/zaklang', 'push', 'bob', { count: 4 });
  await devEvent('jira', 'SD', 'issue.done', 'acc-1');
  await devEvent('jira', 'SD', 'issue.transitioned', 'acc-1');
  // Not counted: another repo, and too long ago.
  await devEvent('github', 'someone/else', 'push', 'gui', { count: 10 });
  await devEvent('github', 'sducf/zaklang', 'push', 'gui', { count: 10, at: daysAgo(30) });
}

async function seedStandups() {
  // Six days. u1 posts in all but the 20th, u2 only on the 22nd, and today's is still open.
  const days = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'];
  for (const [i, day] of days.entries()) {
    const open = day === '2026-09-23';
    const standup = await prisma.sdStandup.create({
      data: {
        guildId: 'g1',
        channelId: 'c1',
        day,
        closesAt: now,
        closedAt: open ? null : now,
        createdAt: daysAgo(days.length - 1 - i),
      },
    });
    const posters = open || day === '2026-09-20' ? [] : day === '2026-09-22' ? ['u1', 'u2'] : ['u1'];
    for (const userId of posters) {
      await prisma.sdStandupEntry.create({ data: { standupId: standup.id, userId, yesterday: 'x', today: 'y' } });
    }
  }
}

describe('activity', () => {
  beforeEach(resetDb);

  it('credits linked people and counts everyone in the team totals', async () => {
    await seedTeam();
    await seedEvents();
    const act = await activity('g1', await listMembers('g1'), daysAgo(14), now);
    expect(act.totals).toEqual({ commits: 9, prsOpened: 1, prsMerged: 1, reviews: 2, issuesDone: 1 });
    expect(act.byMember.get('u1')).toEqual({ commits: 5, prsOpened: 1, prsMerged: 1, reviews: 0, issuesDone: 1 });
    expect(act.byMember.get('u2')).toEqual({ commits: 0, prsOpened: 0, prsMerged: 0, reviews: 2, issuesDone: 0 });
    expect(act.byMember.get('u3')).toEqual({ commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, issuesDone: 0 });
  });

  it('is empty when the server follows no repos', async () => {
    await linkMember('g1', 'u1', { githubLogin: 'gui' });
    await devEvent('github', 'sducf/zaklang', 'push', 'gui', { count: 3 });
    const act = await activity('g1', await listMembers('g1'), daysAgo(14), now);
    expect(act.totals.commits).toBe(0);
  });
});

describe('standupRecords', () => {
  beforeEach(resetDb);

  it('counts attendance in the window and the current streak', async () => {
    await seedStandups();
    const records = await standupRecords('g1', ['u1', 'u2', 'u3'], daysAgo(3));
    // The window covers the 20th through the 23rd: 4 held. Today's open one doesn't break a streak.
    expect(records.get('u1')).toEqual({ posted: 2, held: 4, streak: 2 });
    expect(records.get('u2')).toEqual({ posted: 1, held: 4, streak: 1 });
    expect(records.get('u3')).toEqual({ posted: 0, held: 4, streak: 0 });
  });
});

describe('progress embeds', () => {
  beforeEach(resetDb);

  it('shows one person, and says what is not linked', async () => {
    await seedTeam();
    await seedEvents();
    const members = await listMembers('g1');
    const act = await activity('g1', members, daysAgo(14), now);
    const u2 = members.find((m) => m.userId === 'u2')!;
    const text = renderMemberProgress(u2, 'u2', act.byMember.get('u2')!, { posted: 3, held: 5, streak: 3 }, 14).toJSON()
      .description!;
    expect(text).toContain('**Reviews** 2');
    expect(text).toContain('**Standups** 3/5 · 3 in a row');
    expect(text).toContain('Not linked: Jira');
  });

  it('shows the whole team', async () => {
    await seedTeam();
    await seedEvents();
    const members = await listMembers('g1');
    const act = await activity('g1', members, daysAgo(14), now);
    const embed = renderTeamProgress(members, act, new Map(), 14).toJSON();
    expect(embed.title).toBe('Progress · last 14 days');
    expect(embed.description).toContain('**Team** 9 commits · 1 merged · 2 reviews · 1 done in Jira');
    expect(embed.description).toContain('<@u1> 5 commits');
  });
});

describe('weekly digest', () => {
  beforeEach(resetDb);

  it("sums up the week, who did what, and what's due", async () => {
    await seedTeam();
    await seedEvents();
    await addDeadline('g1', 'Design doc', new Date(now.getTime() + 5 * DAY), 'u1', daysAgo(1));
    const text = (await buildDigest('g1', now)).toJSON().description!;
    expect(text).toContain('**9** commits · **1** PRs merged (1 opened) · **2** reviews · **1** Jira issues done');
    // Whoever shipped the most is listed first.
    expect(text.indexOf('<@u1>')).toBeLessThan(text.indexOf('<@u2>'));
    expect(text).toContain('Design doc');
  });

  it('runs on schedule, queues next week, and ignores old schedules', async () => {
    await seedTeam();
    await configureDigest('g1', { channelId: 'c9', day: 5, clock: { hour: 17, minute: 0 } }, now);
    const [first] = await prisma.job.findMany({ where: { type: JOBS.digest } });
    expect(first!.runAt.toISOString()).toBe('2026-09-25T21:00:00.000Z');
    // The scheduler marks a job running before calling it.
    await prisma.job.update({ where: { id: first!.id }, data: { status: 'running' } });

    const { client, sent } = fakeDiscord();
    await digestJob.run(JSON.parse(first!.payload), { id: first!.id, guildId: 'g1', client });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe('c9');
    expect(embeds(sent[0]!.message)[0]!.title).toBe('Weekly digest');
    expect(await prisma.job.count({ where: { type: JOBS.digest, status: 'pending' } })).toBe(1);

    await disableDigest('g1');
    await digestJob.run(JSON.parse(first!.payload), { id: first!.id, guildId: 'g1', client });
    expect(sent).toHaveLength(1);
  });
});
