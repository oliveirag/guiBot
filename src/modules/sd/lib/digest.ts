import type { Prisma, SdSettings } from '@prisma/client';
import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { prisma } from '../../../db.js';
import { deadlineLine, upcomingWithin } from './deadlines.js';
import { listUpcoming } from './meetings.js';
import { JOBS, scheduleOnce } from './schedule.js';
import { getSettings, updateSettings } from './settings.js';
import { activity, emptyStats, standupRecords, statsLine, type Stats } from './stats.js';
import { listMembers } from './team.js';
import { formatClock, nextOccurrence, parseClock, stamp, type Clock } from './time.js';

const DAY_MS = 86_400_000;
export const DIGEST_DAYS = 7;

export interface DigestPayload {
  version: number;
}

export interface DigestConfig {
  channelId: string;
  day: number;
  clock: Clock;
}

export async function scheduleNextDigest(
  settings: SdSettings,
  after: Date,
  db: Prisma.TransactionClient = prisma,
): Promise<Date | null> {
  if (!settings.digestChannelId) return null;
  const at = nextOccurrence(after, [settings.digestDay], parseClock(settings.digestTime), settings.timezone);
  if (!at) return null;
  const payload: DigestPayload = { version: settings.digestVersion };
  await scheduleOnce(JOBS.digest, at, payload, settings.guildId, db);
  return at;
}

export function configureDigest(guildId: string, cfg: DigestConfig, now = new Date()): Promise<Date | null> {
  return prisma.$transaction(async (tx) => {
    const current = await getSettings(guildId, tx);
    const settings = await updateSettings(
      guildId,
      {
        digestChannelId: cfg.channelId,
        digestDay: cfg.day,
        digestTime: formatClock(cfg.clock),
        digestVersion: current.digestVersion + 1,
      },
      tx,
    );
    return scheduleNextDigest(settings, now, tx);
  });
}

export async function disableDigest(guildId: string): Promise<void> {
  const current = await getSettings(guildId);
  await updateSettings(guildId, { digestChannelId: null, digestVersion: current.digestVersion + 1 });
}

// Rough weight so the list leads with whoever shipped the most.
const weight = (s: Stats): number => s.commits + s.prsMerged * 5 + s.reviews * 2 + s.issuesDone * 3;

/** The last week of work, who did what, and what's coming up. */
export async function buildDigest(guildId: string, now = new Date()): Promise<EmbedBuilder> {
  const since = new Date(now.getTime() - DIGEST_DAYS * DAY_MS);
  const members = await listMembers(guildId);
  const act = await activity(guildId, members, since, now);
  const standups = await standupRecords(
    guildId,
    members.map((m) => m.userId),
    since,
  );
  const deadlines = await upcomingWithin(guildId, now, 14);
  const weekOut = now.getTime() + DIGEST_DAYS * DAY_MS;
  const meetings = (await listUpcoming(guildId, now)).filter((m) => m.startsAt.getTime() < weekOut);

  const t = act.totals;
  const lines = [
    `${stamp(since, 'D')} to ${stamp(now, 'D')}`,
    '',
    `**${t.commits}** commits · **${t.prsMerged}** PRs merged (${t.prsOpened} opened) · **${t.reviews}** reviews · **${t.issuesDone}** Jira issues done`,
  ];

  if (members.length > 0) {
    lines.push('', '**Who did what**');
    const statsOf = (userId: string) => act.byMember.get(userId) ?? emptyStats();
    const ranked = [...members].sort((a, b) => weight(statsOf(b.userId)) - weight(statsOf(a.userId)));
    for (const m of ranked) {
      const st = standups.get(m.userId);
      const standup = st && st.held > 0 ? ` · standups ${st.posted}/${st.held}` : '';
      lines.push(`<@${m.userId}> ${statsLine(statsOf(m.userId))}${standup}`);
    }
  } else {
    lines.push('', 'Link everyone with `/team link` to see who did what.');
  }

  lines.push('', '**Due in the next 2 weeks**');
  lines.push(deadlines.length > 0 ? deadlines.slice(0, 8).map((d) => deadlineLine(d, now)).join('\n') : 'Nothing. Nice.');

  if (meetings.length > 0) {
    lines.push('', '**Meetings this week**');
    lines.push(...meetings.slice(0, 5).map((m) => `**${m.title}** · ${stamp(m.startsAt, 'f')}`));
  }

  return info(lines.join('\n').slice(0, 4096), 'Weekly digest');
}
