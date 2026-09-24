import type { Env } from '../../../env.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { upcomingWithin } from '../../sd/lib/deadlines.js';
import { activeSprint, type SprintSnapshot } from '../../sd/lib/jiraApi.js';
import { sprintSummaryLine } from '../../sd/lib/sprint.js';
import { feedKeys } from '../../sd/lib/stats.js';

export const HISTORY_LIMIT = 15;
const HISTORY_CHARS = 4_000;
const LINE_CHARS = 400;

export interface ChatLine {
  author: string;
  content: string;
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** Oldest first. Keeps the newest lines that fit. */
export function transcript(lines: readonly ChatLine[]): string {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.content.trim()) continue;
    const text = `${line.author}: ${oneLine(line.content, LINE_CHARS)}`;
    if (used + text.length > HISTORY_CHARS) break;
    out.unshift(text);
    used += text.length + 1;
  }
  return out.join('\n');
}

export function buildPrompt(history: readonly ChatLine[], asker: string, question: string): string {
  const chat = transcript(history);
  const ask = `${asker} says to you: ${question.trim() || '(just pinged you)'}`;
  return chat ? `Recent messages in this channel, oldest first:\n${chat}\n\n${ask}` : ask;
}

export type SprintLoader = (jira: NonNullable<Env['jira']>, project: string) => Promise<SprintSnapshot | null>;

/**
 * A short, read-only view of the Senior Design project for the AI: sprint, deadlines, recent dev activity.
 * Null when the server doesn't track anything. Each part is best-effort.
 */
export async function projectSnapshot(
  guildId: string,
  jira: Env['jira'],
  now = new Date(),
  loadSprint: SprintLoader = activeSprint,
): Promise<string | null> {
  const parts: string[] = [];
  const keys = await feedKeys(guildId);

  if (jira && keys.jira.length === 1) {
    try {
      const sprint = await loadSprint(jira, keys.jira[0]!);
      if (sprint) {
        const open = sprint.issues
          .filter((i) => i.category !== 'done')
          .slice(0, 12)
          .map((i) => `- ${i.key} ${oneLine(i.summary, 80)} [${i.status}] ${i.assigneeName ?? 'unassigned'}`);
        parts.push(`Active sprint "${sprint.name}": ${sprintSummaryLine(sprint).replace(/^[▰▱]+ /, '')}`, ...open);
      }
    } catch (error) {
      log.warn('ai: sprint snapshot failed', error);
    }
  }

  const deadlines = await upcomingWithin(guildId, now, 14);
  if (deadlines.length > 0) {
    parts.push('Deadlines in the next 2 weeks:');
    parts.push(...deadlines.slice(0, 8).map((d) => `- ${d.title} due ${d.dueAt.toISOString().slice(0, 16)}Z`));
  }

  const repoKeys = [...keys.github, ...keys.jira];
  if (repoKeys.length > 0) {
    const events = await prisma.devEvent.findMany({
      where: { key: { in: repoKeys } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (events.length > 0) {
      parts.push('Recent GitHub/Jira activity, newest first:');
      parts.push(...events.map((e) => `- ${e.kind} by ${e.actorName ?? e.actor ?? 'someone'}: ${oneLine(e.title, 100)}`));
    }
  }

  return parts.length > 0 ? `Today is ${now.toISOString().slice(0, 10)}.\n${parts.join('\n')}` : null;
}
