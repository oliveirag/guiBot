import { z } from 'zod';
import type { DevEventKind, NormalizedEvent } from './types.js';

const user = z.object({ login: z.string() });
const repository = z.object({ full_name: z.string() });

const pullRequest = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  user,
  merged: z.boolean().nullish(),
  merged_by: user.nullish(),
  base: z.object({ ref: z.string() }),
  draft: z.boolean().optional(),
});

const pullRequestEvent = z.object({
  action: z.string(),
  repository,
  sender: user.optional(),
  requested_reviewer: user.nullish(),
  requested_team: z.object({ name: z.string() }).nullish(),
  pull_request: pullRequest,
});

const reviewEvent = z.object({
  action: z.string(),
  repository,
  pull_request: pullRequest,
  review: z.object({
    state: z.string(),
    body: z.string().nullish(),
    user,
    html_url: z.string(),
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
  repository: repository.extend({ default_branch: z.string().optional() }),
  sender: user,
  commits: z
    .array(
      z.object({
        id: z.string().optional(),
        message: z.string().optional(),
        url: z.string().optional(),
        distinct: z.boolean().optional(),
      }),
    )
    .default([]),
});

const PUSH_COMMITS_SHOWN = 5;

type PushCommit = z.infer<typeof pushEvent>['commits'][number];

/** One linked line per commit (newest last, capped), then who pushed. */
function pushDetail(commits: PushCommit[], pusher: string): string {
  const lines = commits.slice(0, PUSH_COMMITS_SHOWN).map((c) => {
    const short = c.id ? `\`${c.id.slice(0, 7)}\`` : '';
    const sha = short && c.url ? `[${short}](${c.url})` : short;
    const subject = c.message?.split('\n')[0]?.trim() ?? '';
    return [sha, subject].filter(Boolean).join(' ');
  });
  const hidden = commits.length - PUSH_COMMITS_SHOWN;
  if (hidden > 0) lines.push(`…and ${hidden} more`);
  lines.push(`**By** ${pusher} · pull to update`);
  return lines.join('\n');
}

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
  fields: Pick<NormalizedEvent, 'title' | 'url' | 'detail'> & { count?: number; stream?: string },
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
    stream: fields.stream ?? null,
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
      if (action === 'review_requested') {
        const reviewer = parsed.data.requested_reviewer?.login ?? (parsed.data.requested_team ? `team ${parsed.data.requested_team.name}` : null);
        if (!reviewer) return [];
        const asker = parsed.data.sender?.login ?? pr.user.login;
        return [event('pr.review_requested', repo.full_name, asker, { ...base, detail: `${asker} asked ${reviewer} for a review` })];
      }
      return [];
    }
    case 'pull_request_review': {
      const parsed = reviewEvent.safeParse(payload);
      if (!parsed.success || parsed.data.action !== 'submitted') return [];
      const { repository: repo, pull_request: pr, review } = parsed.data;
      const reviewer = review.user.login;
      const quote = review.body?.split('\n')[0]?.trim();
      const withQuote = (line: string) => (quote ? `${line}\n> ${quote}` : line);
      const base = { title: `#${pr.number} ${pr.title}`, url: review.html_url };
      if (review.state === 'approved') {
        return [event('pr.approved', repo.full_name, reviewer, { ...base, detail: withQuote(`Approved by ${reviewer}`) })];
      }
      if (review.state === 'changes_requested') {
        return [event('pr.changes_requested', repo.full_name, reviewer, { ...base, detail: withQuote(`${reviewer} requested changes`) })];
      }
      return [];
    }
    case 'workflow_run': {
      const parsed = workflowRunEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { action, repository: repo, workflow_run: run } = parsed.data;
      if (action !== 'completed') return [];
      const failed = FAILED.has(run.conclusion ?? '');
      if (!failed && run.conclusion !== 'success') return [];
      const name = run.name ?? 'Workflow';
      const actor = run.actor?.login ?? null;
      return [
        event(failed ? 'workflow.failed' : 'workflow.succeeded', repo.full_name, actor, {
          title: `${name} #${run.run_number} ${failed ? 'failed' : 'passed'}`,
          url: run.html_url,
          detail: failureDetail(repo.html_url, run.head_branch, run.head_sha, run.head_commit?.message, actor),
          stream: `${name}@${run.head_branch ?? ''}`,
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
      const distinct = commits.filter((c) => c.distinct !== false);
      const count = distinct.length;
      if (count === 0) return [];
      const branch = ref.slice('refs/heads/'.length);
      const onDefault = branch === repo.default_branch;
      return [
        event(onDefault ? 'push.default' : 'push', repo.full_name, sender.login, {
          title: `${count} commit${count === 1 ? '' : 's'} to ${branch}`,
          url: compare ?? null,
          detail: onDefault ? pushDetail(distinct, sender.login) : null,
          count,
        }),
      ];
    }
    default:
      return [];
  }
}
