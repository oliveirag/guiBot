import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildServer } from '../../../src/core/http.js';
import { prisma } from '../../../src/db.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import { signBody } from '../../../src/modules/dev/lib/signature.js';
import githubRoutes from '../../../src/modules/dev/routes/github.js';
import jiraRoutes from '../../../src/modules/dev/routes/jira.js';
import { resetDb } from '../../db.js';
import { silentLog, testEnv } from '../../helpers.js';

const GH = 'gh-secret';
const JIRA = 'jira-secret';

function makeApp(
  secrets: { githubWebhookSecret?: string; jiraWebhookSecret?: string } = { githubWebhookSecret: GH, jiraWebhookSecret: JIRA },
) {
  return buildServer({ routes: [githubRoutes, jiraRoutes], deps: { env: testEnv(secrets), log: silentLog() } });
}

let app = makeApp();

function github(event: string, delivery: string, payload: unknown, secret = GH) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': signBody(secret, body),
    },
  });
}

function jira(identifier: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/jira',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-atlassian-webhook-identifier': identifier,
      'x-hub-signature': signBody(JIRA, body),
    },
  });
}

const mergedPr = {
  action: 'closed',
  repository: { full_name: 'o/r' },
  pull_request: {
    number: 1,
    title: 'Ship it',
    html_url: 'https://github.com/o/r/pull/1',
    user: { login: 'gui' },
    merged: true,
    merged_by: { login: 'ana' },
    base: { ref: 'main' },
  },
};

describe('dev webhooks', () => {
  beforeEach(async () => {
    await resetDb();
    app = makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('stores an event and queues one notify job per subscribed guild with dev on', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g2', 'github', 'o/r', 'c2');
    await setModuleEnabled('g2', 'dev', false);

    const res = await github('pull_request', 'd1', mergedPr);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ duplicate: false, stored: 1, queued: 1 });
    const event = await prisma.devEvent.findFirstOrThrow();
    expect(event).toMatchObject({ deliveryId: 'github:d1#0', kind: 'pr.merged', key: 'o/r', actor: 'gui' });
    const jobs = await prisma.job.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'dev.notify', guildId: 'g1' });
    expect(JSON.parse(jobs[0]!.payload)).toEqual({ eventId: event.id, channelId: 'c1' });
  });

  it('dedupes a redelivered webhook', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    expect((await github('pull_request', 'd1', mergedPr)).statusCode).toBe(202);
    const again = await github('pull_request', 'd1', mergedPr);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true });
    expect(await prisma.devEvent.count()).toBe(1);
    expect(await prisma.job.count()).toBe(1);
  });

  it('posts default-branch pushes and only stores the rest', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    const push = (ref: string) => ({
      ref,
      repository: { full_name: 'o/r', default_branch: 'main' },
      sender: { login: 'gui' },
      commits: [{ distinct: true }],
    });
    expect((await github('push', 'd2', push('refs/heads/feature'))).json()).toEqual({ duplicate: false, stored: 1, queued: 0 });
    expect((await github('push', 'd3', push('refs/heads/main'))).json()).toEqual({ duplicate: false, stored: 1, queued: 1 });
    expect(await prisma.job.count()).toBe(1);
  });

  it('answers pings and ignores events it does not track', async () => {
    expect((await github('ping', 'p1', { zen: 'hi' })).statusCode).toBe(200);
    const star = await github('star', 's1', { action: 'created' });
    expect(star.statusCode).toBe(202);
    expect(star.json()).toEqual({ duplicate: false, stored: 0, queued: 0 });
    expect(await prisma.devEvent.count()).toBe(0);
  });

  it('rejects a bad signature', async () => {
    const res = await github('pull_request', 'd1', mergedPr, 'wrong');
    expect(res.statusCode).toBe(401);
    expect(await prisma.devEvent.count()).toBe(0);
  });

  it('answers 503 when the secret is unset', async () => {
    await app.close();
    app = makeApp({ jiraWebhookSecret: JIRA });
    expect((await github('pull_request', 'd1', mergedPr)).statusCode).toBe(503);
  });

  it('rejects non-JSON bodies', async () => {
    const body = 'payload=%7B%7D';
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-github-event': 'push',
        'x-github-delivery': 'f1',
        'x-hub-signature-256': signBody(GH, body),
      },
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects invalid JSON and a missing delivery id', async () => {
    const body = '{not json';
    const bad = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'j1',
        'x-hub-signature-256': signBody(GH, body),
      },
    });
    expect(bad.statusCode).toBe(400);

    const noDelivery = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': signBody(GH, '{}') },
    });
    expect(noDelivery.statusCode).toBe(400);
  });

  it('posts "back to green" only when the same workflow and branch failed last time', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    const run = (conclusion: string, n: number, branch = 'main') => ({
      action: 'completed',
      repository: { full_name: 'o/r' },
      workflow_run: { name: 'CI', head_branch: branch, conclusion, html_url: `https://github.com/o/r/actions/runs/${n}`, run_number: n },
    });
    const kinds = async () => (await prisma.devEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => e.kind);

    expect((await github('workflow_run', 'w1', run('success', 1))).json()).toMatchObject({ queued: 0 });
    expect((await github('workflow_run', 'w2', run('failure', 2))).json()).toMatchObject({ queued: 1 });
    expect((await github('workflow_run', 'w3', run('success', 3, 'feature'))).json()).toMatchObject({ queued: 0 });
    expect((await github('workflow_run', 'w4', run('success', 4))).json()).toMatchObject({ queued: 1 });
    expect((await github('workflow_run', 'w5', run('success', 5))).json()).toMatchObject({ queued: 0 });
    expect(await kinds()).toEqual([
      'workflow.succeeded',
      'workflow.failed',
      'workflow.succeeded',
      'workflow.fixed',
      'workflow.succeeded',
    ]);
    const fixed = await prisma.devEvent.findFirstOrThrow({ where: { kind: 'workflow.fixed' } });
    expect(fixed.title).toBe('CI #4 is passing again');
  });

  it('stores each change in one Jira update as its own event', async () => {
    await addFeed('g1', 'jira', 'SD', 'c9');
    const res = await jira('w1', {
      webhookEvent: 'jira:issue_updated',
      user: { accountId: 'acc-1', displayName: 'Gui' },
      issue: {
        key: 'SD-3',
        self: 'https://team.atlassian.net/rest/api/3/issue/3',
        fields: {
          summary: 'Wire login',
          project: { key: 'SD' },
          status: { name: 'Done', statusCategory: { key: 'done' } },
        },
      },
      changelog: {
        items: [
          { field: 'status', fromString: 'In Progress', toString: 'Done' },
          { field: 'assignee', fromString: null, toString: 'Ana' },
        ],
      },
    });
    expect(res.json()).toEqual({ duplicate: false, stored: 2, queued: 2 });
    const kinds = (await prisma.devEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => [e.deliveryId, e.kind]);
    expect(kinds).toEqual([
      ['jira:w1#0', 'issue.done'],
      ['jira:w1#1', 'issue.assigned'],
    ]);
  });
});
