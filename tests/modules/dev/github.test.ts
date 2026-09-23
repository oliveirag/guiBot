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

  it('reports failed workflow runs only', () => {
    const run = (conclusion: string) => ({
      action: 'completed',
      repository,
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        conclusion,
        html_url: 'https://github.com/x/actions/runs/1',
        run_number: 41,
        actor: { login: 'gui' },
      },
    });
    expect(normalizeGithub('workflow_run', run('failure'))).toMatchObject([
      { kind: 'workflow.failed', title: 'CI #41 failed', detail: 'On main', actor: 'gui' },
    ]);
    expect(normalizeGithub('workflow_run', run('success'))).toEqual([]);
    expect(normalizeGithub('workflow_run', run('cancelled'))).toEqual([]);
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
      ref: 'refs/heads/main',
      repository,
      sender: { login: 'gui' },
      compare: 'https://github.com/x/compare/a...b',
      commits: [{ distinct: true }, { distinct: true }, { distinct: false }],
      ...extra,
    });
    expect(normalizeGithub('push', push({}))).toMatchObject([
      { kind: 'push', count: 2, actor: 'gui', title: '2 commits to main', url: 'https://github.com/x/compare/a...b' },
    ]);
    expect(normalizeGithub('push', push({ deleted: true }))).toEqual([]);
    expect(normalizeGithub('push', push({ ref: 'refs/tags/v1' }))).toEqual([]);
    expect(normalizeGithub('push', push({ commits: [] }))).toEqual([]);
  });

  it('ignores unknown events and malformed payloads', () => {
    expect(normalizeGithub('star', { action: 'created', repository })).toEqual([]);
    expect(normalizeGithub('pull_request', { action: 'opened' })).toEqual([]);
    expect(normalizeGithub('push', null)).toEqual([]);
  });
});
