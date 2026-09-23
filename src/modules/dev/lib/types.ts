export type FeedSource = 'github' | 'jira';

export type DevEventKind =
  | 'pr.opened'
  | 'pr.merged'
  | 'pr.review_requested'
  | 'pr.approved'
  | 'pr.changes_requested'
  | 'workflow.failed'
  | 'workflow.succeeded'
  | 'workflow.fixed'
  | 'release.published'
  | 'push'
  | 'push.default'
  | 'issue.created'
  | 'issue.transitioned'
  | 'issue.done'
  | 'issue.assigned';

// Pushes to non-default branches and plain successful runs are stored for Senior Design stats but never posted.
export const NOTIFY_KINDS: ReadonlySet<DevEventKind> = new Set<DevEventKind>([
  'pr.opened',
  'pr.merged',
  'pr.review_requested',
  'pr.approved',
  'pr.changes_requested',
  'workflow.failed',
  'workflow.fixed',
  'release.published',
  'push.default',
  'issue.created',
  'issue.transitioned',
  'issue.done',
  'issue.assigned',
]);

/** One webhook payload becomes zero or more of these. */
export interface NormalizedEvent {
  source: FeedSource;
  kind: DevEventKind;
  /** GitHub "owner/repo" lowercased, or Jira project key uppercased. */
  key: string;
  actor: string | null;
  actorName: string | null;
  title: string;
  url: string | null;
  detail: string | null;
  count: number | null;
  /** "<workflow>@<branch>" for workflow runs, so a success can tell whether the last run failed. */
  stream: string | null;
}
