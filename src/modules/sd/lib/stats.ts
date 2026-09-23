import type { SdMember } from '@prisma/client';
import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { prisma } from '../../../db.js';

export interface Stats {
  commits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issuesDone: number;
}

export interface StandupRecord {
  /** Standups in the window this person posted in. */
  posted: number;
  /** Standups held in the window. */
  held: number;
  /** Standups in a row they've posted in, newest first. Today's still-open one doesn't break it. */
  streak: number;
}

export interface Activity {
  totals: Stats;
  byMember: Map<string, Stats>;
}

export const emptyStats = (): Stats => ({ commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, issuesDone: 0 });

const STREAK_LOOKBACK = 60;

/** Repos and Jira projects this guild follows through /config dev. */
export async function feedKeys(guildId: string): Promise<{ github: string[]; jira: string[] }> {
  const feeds = await prisma.devFeed.findMany({ where: { guildId }, select: { source: true, key: true } });
  return {
    github: feeds.filter((f) => f.source === 'github').map((f) => f.key),
    jira: feeds.filter((f) => f.source === 'jira').map((f) => f.key),
  };
}

function tally(stats: Stats, kind: string, count: number | null): boolean {
  switch (kind) {
    case 'push':
    case 'push.default':
      stats.commits += count ?? 0;
      return true;
    case 'pr.opened':
      stats.prsOpened++;
      return true;
    case 'pr.merged':
      stats.prsMerged++;
      return true;
    case 'pr.approved':
    case 'pr.changes_requested':
      stats.reviews++;
      return true;
    case 'issue.done':
      stats.issuesDone++;
      return true;
    default:
      return false;
  }
}

/** Team totals and per-member stats from stored webhook events in [since, until). */
export async function activity(guildId: string, members: SdMember[], since: Date, until = new Date()): Promise<Activity> {
  const keys = await feedKeys(guildId);
  const byGithub = new Map(members.filter((m) => m.githubLogin).map((m) => [m.githubLogin!, m.userId]));
  const byJira = new Map(members.filter((m) => m.jiraAccountId).map((m) => [m.jiraAccountId!, m.userId]));
  const result: Activity = { totals: emptyStats(), byMember: new Map(members.map((m) => [m.userId, emptyStats()])) };
  if (keys.github.length === 0 && keys.jira.length === 0) return result;

  const events = await prisma.devEvent.findMany({
    where: {
      createdAt: { gte: since, lt: until },
      OR: [
        { source: 'github', key: { in: keys.github } },
        { source: 'jira', key: { in: keys.jira } },
      ],
    },
    select: { source: true, kind: true, actor: true, count: true },
  });
  for (const e of events) {
    if (!tally(result.totals, e.kind, e.count) || !e.actor) continue;
    // GitHub logins are case-insensitive; SQLite can't compare them that way, so match here.
    const userId = e.source === 'github' ? byGithub.get(e.actor.toLowerCase()) : byJira.get(e.actor);
    if (userId) tally(result.byMember.get(userId)!, e.kind, e.count);
  }
  return result;
}

/** Standup attendance per user since `since`, plus their current streak. */
export async function standupRecords(
  guildId: string,
  userIds: string[],
  since: Date,
): Promise<Map<string, StandupRecord>> {
  const standups = await prisma.sdStandup.findMany({
    where: { guildId },
    orderBy: { day: 'desc' },
    take: STREAK_LOOKBACK,
    include: { entries: { select: { userId: true } } },
  });
  const records = new Map<string, StandupRecord>();
  for (const userId of userIds) {
    const record: StandupRecord = { posted: 0, held: 0, streak: 0 };
    let streaking = true;
    for (const [i, s] of standups.entries()) {
      const posted = s.entries.some((e) => e.userId === userId);
      if (s.createdAt.getTime() >= since.getTime()) {
        record.held++;
        if (posted) record.posted++;
      }
      if (!streaking) continue;
      if (posted) record.streak++;
      else if (!(i === 0 && !s.closedAt)) streaking = false;
    }
    records.set(userId, record);
  }
  return records;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function statsLine(s: Stats): string {
  return [plural(s.commits, 'commit'), `${s.prsMerged} merged`, plural(s.reviews, 'review'), `${s.issuesDone} done in Jira`].join(
    ' · ',
  );
}

export function renderMemberProgress(
  member: SdMember | null,
  userId: string,
  stats: Stats,
  standup: StandupRecord,
  days: number,
): EmbedBuilder {
  const lines = [
    `<@${userId}>`,
    '',
    `**Commits** ${stats.commits}`,
    `**Pull requests** ${stats.prsOpened} opened · ${stats.prsMerged} merged`,
    `**Reviews** ${stats.reviews}`,
    `**Jira issues done** ${stats.issuesDone}`,
    `**Standups** ${standup.posted}/${standup.held}${standup.streak > 1 ? ` · ${standup.streak} in a row` : ''}`,
  ];
  const gaps: string[] = [];
  if (!member?.githubLogin) gaps.push('GitHub');
  if (!member?.jiraAccountId) gaps.push('Jira');
  if (gaps.length > 0) lines.push('', `Not linked: ${gaps.join(', ')}. Those numbers stay at 0 until \`/team link\`.`);
  return info(lines.join('\n'), `Progress · last ${plural(days, 'day')}`);
}

export function renderTeamProgress(
  members: SdMember[],
  act: Activity,
  standups: Map<string, StandupRecord>,
  days: number,
): EmbedBuilder {
  const lines = [`**Team** ${statsLine(act.totals)}`, ''];
  if (members.length === 0) lines.push('Nobody is linked yet. Everyone runs `/team link` once.');
  for (const m of members) {
    const s = act.byMember.get(m.userId) ?? emptyStats();
    const st = standups.get(m.userId);
    const standup = st && st.held > 0 ? ` · standups ${st.posted}/${st.held}` : '';
    lines.push(`<@${m.userId}> ${statsLine(s)}${standup}`);
  }
  return info(lines.join('\n').slice(0, 4096), `Progress · last ${plural(days, 'day')}`);
}
