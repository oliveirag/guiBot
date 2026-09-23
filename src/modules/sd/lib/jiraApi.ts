import { z } from 'zod';
import { UserError } from '../../../core/errors.js';

export interface JiraCreds {
  baseUrl: string;
  email: string;
  token: string;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type StatusCategory = 'new' | 'indeterminate' | 'done';

export interface SprintIssue {
  key: string;
  summary: string;
  status: string;
  category: StatusCategory;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface SprintSnapshot {
  name: string;
  goal: string | null;
  endDate: Date | null;
  issues: SprintIssue[];
}

export class JiraApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Jira ${path} returned ${status}`);
    this.name = 'JiraApiError';
  }
}

const MAX_ISSUES = 500;

async function jiraGet(creds: JiraCreds, path: string, fetchImpl: FetchLike): Promise<unknown> {
  const auth = Buffer.from(`${creds.email}:${creds.token}`).toString('base64');
  const res = await fetchImpl(`${creds.baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new UserError(
      "Jira didn't accept the login. JIRA_EMAIL must be the email of the account that made JIRA_API_TOKEN, and the token must be a plain one (not \"with scopes\").",
    );
  }
  if (res.status === 403) {
    throw new UserError("Jira accepted the login, but that account can't see this. Give it access to the project.");
  }
  if (!res.ok) throw new JiraApiError(res.status, path.split('?')[0]!);
  return res.json();
}

const userList = z.array(
  z.object({ accountId: z.string(), displayName: z.string().optional(), accountType: z.string().optional() }),
);

/** Jira hides most emails, but user search still matches on them. Null when nobody (or several people) match. */
export async function findAccountId(creds: JiraCreds, email: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const users = userList.parse(await jiraGet(creds, `/rest/api/3/user/search?query=${encodeURIComponent(email)}`, fetchImpl));
  const people = users.filter((u) => !u.accountType || u.accountType === 'atlassian');
  return people.length === 1 ? people[0]!.accountId : null;
}

const boards = z.object({ values: z.array(z.object({ id: z.number(), type: z.string().optional() })) });
const sprints = z.object({
  values: z.array(
    z.object({ id: z.number(), name: z.string(), goal: z.string().nullish(), endDate: z.string().nullish() }),
  ),
});
const issuePage = z.object({
  total: z.number().optional(),
  issues: z.array(
    z.object({
      key: z.string(),
      fields: z.object({
        summary: z.string().nullish(),
        status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).nullish() }).nullish(),
        assignee: z.object({ accountId: z.string(), displayName: z.string().nullish() }).nullish(),
      }),
    }),
  ),
});

const category = (key: string | undefined): StatusCategory =>
  key === 'done' ? 'done' : key === 'indeterminate' ? 'indeterminate' : 'new';

/** The project's active sprint and its issues. Null when the board has no active sprint. */
export async function activeSprint(
  creds: JiraCreds,
  projectKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<SprintSnapshot | null> {
  const found = boards.parse(
    await jiraGet(creds, `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}`, fetchImpl),
  );
  const board = found.values.find((b) => b.type === 'scrum') ?? found.values[0];
  if (!board) throw new UserError(`${projectKey} has no Jira board I can see.`);

  let active;
  try {
    active = sprints.parse(await jiraGet(creds, `/rest/agile/1.0/board/${board.id}/sprint?state=active`, fetchImpl));
  } catch (error) {
    // Kanban boards answer 400 here: they don't have sprints.
    if (error instanceof JiraApiError && error.status === 400) {
      throw new UserError(`${projectKey}'s board doesn't use sprints.`);
    }
    throw error;
  }
  const sprint = active.values[0];
  if (!sprint) return null;

  const issues: SprintIssue[] = [];
  for (let startAt = 0; startAt < MAX_ISSUES; ) {
    const page = issuePage.parse(
      await jiraGet(
        creds,
        `/rest/agile/1.0/sprint/${sprint.id}/issue?fields=summary,status,assignee&maxResults=100&startAt=${startAt}`,
        fetchImpl,
      ),
    );
    for (const issue of page.issues) {
      const f = issue.fields;
      issues.push({
        key: issue.key,
        summary: f.summary ?? '',
        status: f.status?.name ?? '?',
        category: category(f.status?.statusCategory?.key),
        assigneeId: f.assignee?.accountId ?? null,
        assigneeName: f.assignee?.displayName ?? null,
      });
    }
    startAt += page.issues.length;
    if (page.issues.length === 0 || startAt >= (page.total ?? 0)) break;
  }

  return {
    name: sprint.name,
    goal: sprint.goal?.trim() || null,
    endDate: sprint.endDate ? new Date(sprint.endDate) : null,
    issues,
  };
}
