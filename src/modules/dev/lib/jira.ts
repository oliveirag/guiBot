import { z } from 'zod';
import type { NormalizedEvent } from './types.js';

const person = z.object({ accountId: z.string(), displayName: z.string() });

const issueEvent = z.object({
  webhookEvent: z.string(),
  user: person.nullish(),
  issue: z.object({
    key: z.string(),
    self: z.string(),
    fields: z.object({
      summary: z.string(),
      project: z.object({ key: z.string() }),
      issuetype: z.object({ name: z.string() }).nullish(),
      status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).nullish() }).nullish(),
    }),
  }),
  changelog: z
    .object({
      items: z.array(z.object({ field: z.string(), fromString: z.string().nullish(), toString: z.string().nullish() })),
    })
    .nullish(),
});

function browseUrl(self: string, issueKey: string): string | null {
  try {
    return `${new URL(self).origin}/browse/${issueKey}`;
  } catch {
    return null;
  }
}

export function normalizeJira(payload: unknown): NormalizedEvent[] {
  const parsed = issueEvent.safeParse(payload);
  if (!parsed.success) return [];
  const { webhookEvent, user, issue, changelog } = parsed.data;
  const common = {
    source: 'jira' as const,
    key: issue.fields.project.key.toUpperCase(),
    actor: user?.accountId ?? null,
    actorName: user?.displayName ?? null,
    title: `${issue.key} ${issue.fields.summary}`,
    url: browseUrl(issue.self, issue.key),
    count: null,
  };

  if (webhookEvent === 'jira:issue_created') {
    const type = issue.fields.issuetype?.name ?? 'Issue';
    return [{ ...common, kind: 'issue.created', detail: `${type} created${user ? ` by ${user.displayName}` : ''}` }];
  }
  if (webhookEvent !== 'jira:issue_updated') return [];

  const events: NormalizedEvent[] = [];
  for (const item of changelog?.items ?? []) {
    if (item.field === 'status') {
      const done = issue.fields.status?.statusCategory?.key === 'done';
      events.push({
        ...common,
        kind: done ? 'issue.done' : 'issue.transitioned',
        detail: `${item.fromString ?? '?'} → ${item.toString ?? '?'}`,
      });
    } else if (item.field === 'assignee') {
      events.push({ ...common, kind: 'issue.assigned', detail: item.toString ? `Assigned to ${item.toString}` : 'Unassigned' });
    }
  }
  return events;
}
