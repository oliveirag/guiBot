import { z } from 'zod';
import type { DevEventKind, NormalizedEvent } from './types.js';

const user = z.object({ login: z.string() });
const repository = z.object({ full_name: z.string() });

const pullRequestEvent = z.object({
  action: z.string(),
  repository,
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    user,
    merged: z.boolean().nullish(),
    merged_by: user.nullish(),
    base: z.object({ ref: z.string() }),
    draft: z.boolean().optional(),
  }),
});

const workflowRunEvent = z.object({
  action: z.string(),
  repository: repository.extend({ html_url: z.string().optional() }),
  workflow_run: z.object({
    name: z.string().nullish(),
    head_branch: z.string().nullish(),
    head_sha: z.string().nullish(),
    head_commit: z.object({ message: z.string() }).nullish(),
    conclusion: z.string().nullish(),
    html_url: z.string(),
    run_number: z.number(),
    actor: user.nullish(),
  }),
});

const releaseEvent = z.object({
  action: z.string(),
  repository,
  release: z.object({
    tag_name: z.string(),
    name: z.string().nullish(),
    html_url: z.string(),
    prerelease: z.boolean(),
    author: user.nullish(),
  }),
});

const pushEvent = z.object({
  ref: z.string(),
  deleted: z.boolean().optional(),
  compare: z.string().nullish(),
  repository,
  sender: user,
  commits: z.array(z.object({ distinct: z.boolean().optional() })).default([]),
});

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Branch, linked short commit, and who ran it, one per line. Null when the payload has none of them. */
function failureDetail(
  repoUrl: string | undefined,
  branch: string | null | undefined,
  sha: string | null | undefined,
  message: string | undefined,
  actor: string | null,
): string | null {
  const lines: string[] = [];
  if (branch) lines.push(`**Branch** ${branch}`);
  if (sha) {
    const short = `\`${sha.slice(0, 7)}\``;
    const commit = repoUrl ? `[${short}](${repoUrl}/commit/${sha})` : short;
    const subject = message?.split('\n')[0]?.trim();
    lines.push(`**Commit** ${commit}${subject ? ` ${subject}` : ''}`);
  }
  if (actor) lines.push(`**By** ${actor}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function event(
  kind: DevEventKind,
  fullName: string,
  actor: string | null,
  fields: Pick<NormalizedEvent, 'title' | 'url' | 'detail'> & { count?: number },
): NormalizedEvent {
  return {
    source: 'github',
    kind,
    key: fullName.toLowerCase(),
    actor,
    actorName: actor,
    title: fields.title,
    url: fields.url,
    detail: fields.detail,
    count: fields.count ?? null,
  };
}

export function normalizeGithub(name: string, payload: unknown): NormalizedEvent[] {
  switch (name) {
    case 'pull_request': {
      const parsed = pullRequestEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { action, repository: repo, pull_request: pr } = parsed.data;
      const base = { title: `#${pr.number} ${pr.title}`, url: pr.html_url };
      if ((action === 'opened' && !pr.draft) || action === 'ready_for_review') {
        return [event('pr.opened', repo.full_name, pr.user.login, { ...base, detail: `${pr.user.login} wants to merge into ${pr.base.ref}` })];
      }
      if (action === 'closed' && pr.merged) {
        const by = pr.merged_by ? ` by ${pr.merged_by.login}` : '';
        return [event('pr.merged', repo.full_name, pr.user.login, { ...base, detail: `Merged into ${pr.base.ref}${by}` })];
      }
      return [];
    }
    case 'workflow_run': {
      const parsed = workflowRunEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { action, repository: repo, workflow_run: run } = parsed.data;
      if (action !== 'completed' || !FAILED.has(run.conclusion ?? '')) return [];
      const actor = run.actor?.login ?? null;
      return [
        event('workflow.failed', repo.full_name, actor, {
          title: `${run.name ?? 'Workflow'} #${run.run_number} failed`,
          url: run.html_url,
          detail: failureDetail(repo.html_url, run.head_branch, run.head_sha, run.head_commit?.message, actor),
        }),
      ];
    }
    case 'release': {
      const parsed = releaseEvent.safeParse(payload);
      if (!parsed.success || parsed.data.action !== 'published') return [];
      const { repository: repo, release } = parsed.data;
      return [
        event('release.published', repo.full_name, release.author?.login ?? null, {
          title: release.name?.trim() || release.tag_name,
          url: release.html_url,
          detail: `${release.prerelease ? 'Pre-release' : 'Tagged'} ${release.tag_name}`,
        }),
      ];
    }
    case 'push': {
      const parsed = pushEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { ref, deleted, compare, repository: repo, sender, commits } = parsed.data;
      if (deleted || !ref.startsWith('refs/heads/')) return [];
      const count = commits.filter((c) => c.distinct !== false).length;
      if (count === 0) return [];
      const branch = ref.slice('refs/heads/'.length);
      return [
        event('push', repo.full_name, sender.login, {
          title: `${count} commit${count === 1 ? '' : 's'} to ${branch}`,
          url: compare ?? null,
          detail: null,
          count,
        }),
      ];
    }
    default:
      return [];
  }
}
