import { describe, expect, it } from 'vitest';
import { normalizeJira } from '../../../src/modules/dev/lib/jira.js';

const issue = (statusCategory = 'indeterminate') => ({
  key: 'SD-12',
  self: 'https://team.atlassian.net/rest/api/3/issue/10012',
  fields: {
    summary: 'Build login page',
    project: { key: 'sd' },
    issuetype: { name: 'Story' },
    status: { name: 'In Progress', statusCategory: { key: statusCategory } },
  },
});
const user = { accountId: 'acc-1', displayName: 'Gui' };

describe('normalizeJira', () => {
  it('turns issue_created into issue.created', () => {
    expect(normalizeJira({ webhookEvent: 'jira:issue_created', user, issue: issue() })).toEqual([
      {
        source: 'jira',
        kind: 'issue.created',
        key: 'SD',
        actor: 'acc-1',
        actorName: 'Gui',
        title: 'SD-12 Build login page',
        url: 'https://team.atlassian.net/browse/SD-12',
        detail: 'Story created by Gui',
        count: null,
      },
    ]);
  });

  it('emits one event per status or assignee change', () => {
    const events = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue(),
      changelog: {
        items: [
          { field: 'status', fromString: 'To Do', toString: 'In Progress' },
          { field: 'summary', fromString: 'a', toString: 'b' },
          { field: 'assignee', fromString: null, toString: 'Ana' },
        ],
      },
    });
    expect(events.map((e) => [e.kind, e.detail])).toEqual([
      ['issue.transitioned', 'To Do → In Progress'],
      ['issue.assigned', 'Assigned to Ana'],
    ]);
  });

  it('marks moves into a done category as issue.done', () => {
    const [event] = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue('done'),
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    });
    expect(event).toMatchObject({ kind: 'issue.done', detail: 'In Progress → Done' });
  });

  it('reports unassignment', () => {
    const [event] = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue(),
      changelog: { items: [{ field: 'assignee', fromString: 'Ana', toString: null }] },
    });
    expect(event).toMatchObject({ kind: 'issue.assigned', detail: 'Unassigned' });
  });

  it('ignores updates with no relevant changes, other events, and malformed payloads', () => {
    expect(normalizeJira({ webhookEvent: 'jira:issue_updated', user, issue: issue() })).toEqual([]);
    expect(normalizeJira({ webhookEvent: 'comment_created', user, issue: issue() })).toEqual([]);
    expect(normalizeJira({ webhookEvent: 'jira:issue_created' })).toEqual([]);
    expect(normalizeJira('nope')).toEqual([]);
  });

  it('leaves url null when issue.self is not a URL', () => {
    const bad = { ...issue(), self: 'not a url' };
    expect(normalizeJira({ webhookEvent: 'jira:issue_created', user, issue: bad })[0]!.url).toBeNull();
  });
});
