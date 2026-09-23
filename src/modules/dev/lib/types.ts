export type FeedSource = 'github' | 'jira';

export type DevEventKind =
  | 'pr.opened'
  | 'pr.merged'
  | 'workflow.failed'
  | 'release.published'
  | 'push'
  | 'issue.created'
  | 'issue.transitioned'
  | 'issue.done'
  | 'issue.assigned';

// Pushes are stored for Senior Design stats but never posted.
export const NOTIFY_KINDS: ReadonlySet<DevEventKind> = new Set<DevEventKind>([
  'pr.opened',
  'pr.merged',
  'workflow.failed',
  'release.published',
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
}
