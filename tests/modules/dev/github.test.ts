import { describe, expect, it } from 'vitest';
import { normalizeGithub } from '../../../src/modules/dev/lib/github.js';

const repository = { full_name: 'OliveiraG/guiBot' };
const pr = (extra: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add login',
  html_url: 'https://github.com/OliveiraG/guiBot/pull/12',
  user: { login: 'gui' },
  merged: false,
  merged_by: null,
  base: { ref: 'main' },
  draft: false,
  ...extra,
});

describe('normalizeGithub', () => {
  it('turns an opened PR into pr.opened', () => {
    expect(normalizeGithub('pull_request', { action: 'opened', repository, pull_request: pr() })).toEqual([
      {
        source: 'github',
        kind: 'pr.opened',
        key: 'oliveirag/guibot',
        actor: 'gui',
        actorName: 'gui',
        title: '#12 Add login',
        url: 'https://github.com/OliveiraG/guiBot/pull/12',
        detail: 'gui wants to merge into main',
        count: null,
        stream: null,
      },
    ]);
  });

  it('skips draft PRs until they are ready for review', () => {
    expect(normalizeGithub('pull_request', { action: 'opened', repository, pull_request: pr({ draft: true }) })).toEqual([]);
    const ready = normalizeGithub('pull_request', { action: 'ready_for_review', repository, pull_request: pr() });
    expect(ready.map((e) => e.kind)).toEqual(['pr.opened']);
  });

  it('turns a merged PR into pr.merged and ignores closed-unmerged', () => {
    const merged = normalizeGithub('pull_request', {
      action: 'closed',
      repository,
      pull_request: pr({ merged: true, merged_by: { login: 'ana' } }),
    });
    expect(merged).toMatchObject([{ kind: 'pr.merged', actor: 'gui', detail: 'Merged into main by ana' }]);
    expect(normalizeGithub('pull_request', { action: 'closed', repository, pull_request: pr() })).toEqual([]);
  });

  it('reports failed workflow runs only, with branch, commit, and who ran it', () => {
    const run = (conclusion: string) => ({
      action: 'completed',
      repository: { ...repository, html_url: 'https://github.com/OliveiraG/guiBot' },
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        head_sha: 'a1b2c3d4e5f6a7b8c9d0',
        head_commit: { message: 'Fix login redirect\n\nLonger body here' },
        conclusion,
        html_url: 'https://github.com/x/actions/runs/1',
        run_number: 41,
        actor: { login: 'gui' },
      },
    });
    expect(normalizeGithub('workflow_run', run('failure'))).toMatchObject([
      {
        kind: 'workflow.failed',
        title: 'CI #41 failed',
        actor: 'gui',
        detail: [
          '**Branch** main',
          '**Commit** [`a1b2c3d`](https://github.com/OliveiraG/guiBot/commit/a1b2c3d4e5f6a7b8c9d0) Fix login redirect',
          '**By** gui',
        ].join('\n'),
      },
    ]);
    // Successes are stored (not posted) so "back to green" can be detected.
    expect(normalizeGithub('workflow_run', run('success'))).toMatchObject([{ kind: 'workflow.succeeded' }]);
    expect(normalizeGithub('workflow_run', run('cancelled'))).toEqual([]);
  });

  it('keeps failed-run details that are missing from the payload out of the embed', () => {
    const [event] = normalizeGithub('workflow_run', {
      action: 'completed',
      repository,
      workflow_run: { name: 'CI', conclusion: 'failure', html_url: 'https://github.com/x/actions/runs/2', run_number: 7 },
    });
    expect(event!.detail).toBeNull();
  });

  it('tags workflow runs with a workflow@branch stream and stores successes quietly', () => {
    const run = (conclusion: string) => ({
      action: 'completed',
      repository,
      workflow_run: { name: 'CI', head_branch: 'main', conclusion, html_url: 'https://github.com/x/actions/runs/3', run_number: 42, actor: { login: 'gui' } },
    });
    expect(normalizeGithub('workflow_run', run('failure'))).toMatchObject([{ kind: 'workflow.failed', stream: 'CI@main' }]);
    expect(normalizeGithub('workflow_run', run('success'))).toMatchObject([
      { kind: 'workflow.succeeded', stream: 'CI@main', title: 'CI #42 passed' },
    ]);
  });

  it('turns a review request into pr.review_requested', () => {
    const [event] = normalizeGithub('pull_request', {
      action: 'review_requested',
      repository,
      sender: { login: 'gui' },
      requested_reviewer: { login: 'ana' },
      pull_request: pr(),
    });
    expect(event).toMatchObject({ kind: 'pr.review_requested', actor: 'gui', title: '#12 Add login', detail: 'gui asked ana for a review' });
  });

  it('names the team when a team is asked to review', () => {
    const [event] = normalizeGithub('pull_request', {
      action: 'review_requested',
      repository,
      sender: { login: 'gui' },
      requested_team: { name: 'backend' },
      pull_request: pr(),
    });
    expect(event!.detail).toBe('gui asked team backend for a review');
  });

  it('turns approvals and change requests into review events, and skips plain comments', () => {
    const review = (state: string, body: string | null = null) => ({
      action: 'submitted',
      repository,
      pull_request: pr(),
      review: { state, body, user: { login: 'ana' }, html_url: 'https://github.com/x/pull/12#pullrequestreview-1' },
    });
    expect(normalizeGithub('pull_request_review', review('approved'))).toMatchObject([
      { kind: 'pr.approved', actor: 'ana', detail: 'Approved by ana', url: 'https://github.com/x/pull/12#pullrequestreview-1' },
    ]);
    expect(normalizeGithub('pull_request_review', review('changes_requested', 'Rename this\nand add a test'))).toMatchObject([
      { kind: 'pr.changes_requested', detail: 'ana requested changes\n> Rename this' },
    ]);
    expect(normalizeGithub('pull_request_review', review('commented'))).toEqual([]);
  });

  it('turns a published release into release.published', () => {
    const release = (prerelease: boolean, name: string | null) => ({
      action: 'published',
      repository,
      release: { tag_name: 'v1.0.0', name, html_url: 'https://github.com/x/releases/v1.0.0', prerelease, author: { login: 'gui' } },
    });
    expect(normalizeGithub('release', release(false, 'Launch'))).toMatchObject([
      { kind: 'release.published', title: 'Launch', detail: 'Tagged v1.0.0' },
    ]);
    expect(normalizeGithub('release', release(true, null))).toMatchObject([{ title: 'v1.0.0', detail: 'Pre-release v1.0.0' }]);
  });

  it('stores branch pushes with their distinct commit count', () => {
    const push = (extra: Record<string, unknown>) => ({
      ref: 'refs/heads/feature',
      repository: { ...repository, default_branch: 'main' },
      sender: { login: 'gui' },
      compare: 'https://github.com/x/compare/a...b',
      commits: [{ distinct: true }, { distinct: true }, { distinct: false }],
      ...extra,
    });
    expect(normalizeGithub('push', push({}))).toMatchObject([
      { kind: 'push', count: 2, actor: 'gui', title: '2 commits to feature', url: 'https://github.com/x/compare/a...b' },
    ]);
    expect(normalizeGithub('push', push({ deleted: true }))).toEqual([]);
    expect(normalizeGithub('push', push({ ref: 'refs/tags/v1' }))).toEqual([]);
    expect(normalizeGithub('push', push({ commits: [] }))).toEqual([]);
  });

  it('marks default-branch pushes for posting and lists their commits', () => {
    const commit = (n: number, distinct = true) => ({
      id: `${n}`.repeat(40),
      message: `Commit ${n}\n\nbody`,
      url: `https://github.com/x/commit/${n}`,
      distinct,
    });
    const push = (commits: unknown[]) => ({
      ref: 'refs/heads/main',
      repository: { ...repository, default_branch: 'main' },
      sender: { login: 'gui' },
      compare: 'https://github.com/x/compare/a...b',
      commits,
    });

    expect(normalizeGithub('push', push([commit(1), commit(2, false)]))).toMatchObject([
      {
        kind: 'push.default',
        count: 1,
        title: '1 commit to main',
        detail: '[`1111111`](https://github.com/x/commit/1) Commit 1\n**By** gui · pull to update',
      },
    ]);

    const [many] = normalizeGithub('push', push([1, 2, 3, 4, 5, 6, 7].map((n) => commit(n))));
    expect(many!.detail!.split('\n')).toHaveLength(7);
    expect(many!.detail).toContain('Commit 5');
    expect(many!.detail).not.toContain('Commit 6');
    expect(many!.detail).toContain('and 2 more');
  });

  it('ignores unknown events and malformed payloads', () => {
    expect(normalizeGithub('star', { action: 'created', repository })).toEqual([]);
    expect(normalizeGithub('pull_request', { action: 'opened' })).toEqual([]);
    expect(normalizeGithub('push', null)).toEqual([]);
  });
});
