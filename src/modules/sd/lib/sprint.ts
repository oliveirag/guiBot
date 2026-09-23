import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import type { SprintIssue, SprintSnapshot, StatusCategory } from './jiraApi.js';
import { stamp } from './time.js';

const PER_SECTION = 8;

export function progressBar(done: number, total: number, width = 14): string {
  if (total === 0) return '▱'.repeat(width);
  const filled = Math.round((done / total) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function person(id: string, name: string | null | undefined, assignees: ReadonlyMap<string, string>): string {
  const userId = assignees.get(id);
  return userId ? `<@${userId}>` : (name ?? 'someone');
}

function issueLine(issue: SprintIssue, baseUrl: string, assignees: ReadonlyMap<string, string>): string {
  const who = issue.assigneeId ? person(issue.assigneeId, issue.assigneeName, assignees) : 'unassigned';
  return `[${issue.key}](${baseUrl}/browse/${issue.key}) ${clip(issue.summary, 60)} · ${who}`;
}

function section(issues: SprintIssue[], baseUrl: string, assignees: ReadonlyMap<string, string>): string {
  if (issues.length === 0) return '-';
  const lines = issues.slice(0, PER_SECTION).map((i) => issueLine(i, baseUrl, assignees));
  if (issues.length > PER_SECTION) lines.push(`…and ${issues.length - PER_SECTION} more`);
  // Field values cap at 1024 characters.
  while (lines.length > 1 && lines.join('\n').length > 1024) lines.splice(lines.length - 2, 1);
  return lines.join('\n').slice(0, 1024);
}

export function sprintCounts(issues: SprintIssue[]): Record<StatusCategory, number> {
  const counts: Record<StatusCategory, number> = { new: 0, indeterminate: 0, done: 0 };
  for (const i of issues) counts[i.category]++;
  return counts;
}

export function sprintSummaryLine(sprint: SprintSnapshot): string {
  const counts = sprintCounts(sprint.issues);
  const total = sprint.issues.length;
  const pct = total === 0 ? 0 : Math.round((counts.done / total) * 100);
  return `${progressBar(counts.done, total)} ${counts.done}/${total} done (${pct}%)`;
}

/** `assignees` maps Jira accountId to Discord user id, so linked people get mentioned. */
export function renderSprint(
  sprint: SprintSnapshot,
  projectKey: string,
  baseUrl: string,
  assignees: ReadonlyMap<string, string>,
): EmbedBuilder {
  const lines = [sprintSummaryLine(sprint)];
  if (sprint.endDate) lines.push(`**Ends** ${stamp(sprint.endDate, 'D')} (${stamp(sprint.endDate, 'R')})`);
  if (sprint.goal) lines.push(`**Goal** ${clip(sprint.goal, 300)}`);

  const by = (c: StatusCategory) => sprint.issues.filter((i) => i.category === c);
  const embed = info(lines.join('\n'), `${sprint.name} · ${projectKey}`).addFields(
    { name: `To do (${by('new').length})`, value: section(by('new'), baseUrl, assignees) },
    { name: `In progress (${by('indeterminate').length})`, value: section(by('indeterminate'), baseUrl, assignees) },
    { name: `Done (${by('done').length})`, value: section(by('done'), baseUrl, assignees) },
  );

  const people = new Map<string, { name: string | null; done: number; total: number }>();
  for (const i of sprint.issues) {
    if (!i.assigneeId) continue;
    const row = people.get(i.assigneeId) ?? { name: i.assigneeName, done: 0, total: 0 };
    row.total++;
    if (i.category === 'done') row.done++;
    people.set(i.assigneeId, row);
  }
  if (people.size > 0) {
    const value = [...people.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([id, r]) => `${person(id, r.name, assignees)} ${r.done}/${r.total}`)
      .join('\n');
    embed.addFields({ name: 'By person', value: value.slice(0, 1024) });
  }
  return embed;
}
