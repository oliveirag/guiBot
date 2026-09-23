import { describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { activeSprint, findAccountId, type FetchLike, type SprintSnapshot } from '../../../src/modules/sd/lib/jiraApi.js';
import { progressBar, renderSprint } from '../../../src/modules/sd/lib/sprint.js';

const creds = { baseUrl: 'https://sd.atlassian.net', email: 'bot@ucf.edu', token: 'secret' };

/** Answers by the longest matching path prefix; anything unmatched is a 404. */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn<FetchLike>(async (url) => {
    const path = url.replace(creds.baseUrl, '');
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    const body = match === undefined ? { status: 404 } : routes[match];
    const status = (body as { status?: number } | null)?.status ?? 200;
    return { ok: status < 300, status, json: async () => body };
  });
}

const issue = (key: string, category: string, assignee: string | null) => ({
  key,
  fields: {
    summary: `Work on ${key}`,
    status: { name: category, statusCategory: { key: category } },
    assignee: assignee ? { accountId: assignee, displayName: `Name ${assignee}` } : null,
  },
});

describe('findAccountId', () => {
  it('returns the one person matching an email', async () => {
    const fetch = fakeFetch({
      '/rest/api/3/user/search': [
        { accountId: 'acc-1', accountType: 'atlassian' },
        { accountId: 'app', accountType: 'app' },
      ],
    });
    expect(await findAccountId(creds, 'gui@ucf.edu', fetch)).toBe('acc-1');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://sd.atlassian.net/rest/api/3/user/search?query=gui%40ucf.edu');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('bot@ucf.edu:secret').toString('base64')}`);
  });

  it('returns null for no match or several', async () => {
    expect(await findAccountId(creds, 'x@y.z', fakeFetch({ '/rest/api/3/user/search': [] }))).toBeNull();
    const two = [{ accountId: 'a' }, { accountId: 'b' }];
    expect(await findAccountId(creds, 'x@y.z', fakeFetch({ '/rest/api/3/user/search': two }))).toBeNull();
  });

  it('tells a bad login apart from missing access', async () => {
    const bad = fakeFetch({ '/rest/api/3/user/search': { status: 401 } });
    await expect(findAccountId(creds, 'x@y.z', bad)).rejects.toThrow(/didn't accept the login/);
    const forbidden = fakeFetch({ '/rest/api/3/user/search': { status: 403 } });
    await expect(findAccountId(creds, 'x@y.z', forbidden)).rejects.toThrow(/can't see this/);
  });
});

describe('activeSprint', () => {
  const board = { '/rest/agile/1.0/board?': { values: [{ id: 7, type: 'kanban' }, { id: 9, type: 'scrum' }] } };
  const page = (startAt: number) =>
    `/rest/agile/1.0/sprint/31/issue?fields=summary,status,assignee&maxResults=100&startAt=${startAt}`;

  it('loads the scrum board, its active sprint, and every page of issues', async () => {
    const fetch = fakeFetch({
      ...board,
      '/rest/agile/1.0/board/9/sprint': {
        values: [{ id: 31, name: 'Sprint 4', goal: ' Ship login ', endDate: '2026-10-02T21:00:00.000Z' }],
      },
      [page(0)]: { total: 3, issues: [issue('SD-1', 'done', 'acc-1'), issue('SD-2', 'indeterminate', 'acc-2')] },
      [page(2)]: { total: 3, issues: [issue('SD-3', 'new', null)] },
    });
    const sprint = await activeSprint(creds, 'SD', fetch);
    expect(sprint).toMatchObject({ name: 'Sprint 4', goal: 'Ship login', endDate: new Date('2026-10-02T21:00:00Z') });
    expect(sprint!.issues.map((i) => [i.key, i.category, i.assigneeId])).toEqual([
      ['SD-1', 'done', 'acc-1'],
      ['SD-2', 'indeterminate', 'acc-2'],
      ['SD-3', 'new', null],
    ]);
  });

  it('returns null with no active sprint', async () => {
    const fetch = fakeFetch({ ...board, '/rest/agile/1.0/board/9/sprint': { values: [] } });
    expect(await activeSprint(creds, 'SD', fetch)).toBeNull();
  });

  it('explains boards without sprints and projects without boards', async () => {
    const kanban = fakeFetch({
      '/rest/agile/1.0/board?': { values: [{ id: 7, type: 'kanban' }] },
      '/rest/agile/1.0/board/7/sprint': { status: 400 },
    });
    await expect(activeSprint(creds, 'SD', kanban)).rejects.toThrow(/doesn't use sprints/);
    const none = fakeFetch({ '/rest/agile/1.0/board?': { values: [] } });
    await expect(activeSprint(creds, 'SD', none)).rejects.toThrow(UserError);
  });
});

describe('renderSprint', () => {
  const base = { status: 'x', assigneeName: null as string | null };
  const sprint: SprintSnapshot = {
    name: 'Sprint 4',
    goal: 'Ship login',
    endDate: new Date('2026-10-02T21:00:00Z'),
    issues: [
      { ...base, key: 'SD-1', summary: 'Login form', category: 'done', assigneeId: 'acc-1', assigneeName: 'Gui' },
      { ...base, key: 'SD-2', summary: 'Auth API', category: 'indeterminate', assigneeId: 'acc-1', assigneeName: 'Gui' },
      { ...base, key: 'SD-3', summary: 'Docs', category: 'new', assigneeId: 'acc-9', assigneeName: 'Ana' },
      { ...base, key: 'SD-4', summary: 'Tests', category: 'new', assigneeId: null },
    ],
  };

  it('shows progress, sections, and who owns what', () => {
    const json = renderSprint(sprint, 'SD', creds.baseUrl, new Map([['acc-1', 'u1']])).toJSON();
    expect(json.title).toBe('Sprint 4 · SD');
    expect(json.description).toContain('1/4 done (25%)');
    expect(json.description).toContain('**Goal** Ship login');
    const fields = Object.fromEntries(json.fields!.map((f) => [f.name, f.value]));
    expect(fields['To do (2)']).toContain('[SD-3](https://sd.atlassian.net/browse/SD-3) Docs · Ana');
    expect(fields['To do (2)']).toContain('Tests · unassigned');
    expect(fields['In progress (1)']).toContain('Auth API · <@u1>');
    expect(fields['Done (1)']).toContain('SD-1');
    expect(fields['By person']).toBe('<@u1> 1/2\nAna 0/1');
  });

  it('keeps big sections under the field limit', () => {
    const many: SprintSnapshot = {
      ...sprint,
      issues: Array.from({ length: 40 }, (_, i) => ({
        ...base,
        key: `SD-${i}`,
        summary: 'x'.repeat(200),
        category: 'new' as const,
        assigneeId: null,
      })),
    };
    const fields = renderSprint(many, 'SD', creds.baseUrl, new Map()).toJSON().fields!;
    expect(fields[0]!.value.length).toBeLessThanOrEqual(1024);
    expect(fields[0]!.value).toContain('…and 32 more');
  });

  it('draws a progress bar', () => {
    expect(progressBar(0, 0, 4)).toBe('▱▱▱▱');
    expect(progressBar(1, 2, 4)).toBe('▰▰▱▱');
    expect(progressBar(2, 2, 4)).toBe('▰▰▰▰');
  });
});
