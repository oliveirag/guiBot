export const RULES = ['spam', 'duplicates', 'invites', 'links', 'words', 'mentions', 'caps', 'newaccount'] as const;
export type RuleName = (typeof RULES)[number];

export const ACTIONS = ['delete', 'warn', 'timeout', 'kick'] as const;
export type RuleAction = (typeof ACTIONS)[number];

export const RULE_INFO: Record<RuleName, { label: string; limit: number | null; limitMeans?: string }> = {
  spam: { label: 'Too many messages too fast', limit: 5, limitMeans: 'messages in 5 seconds' },
  duplicates: { label: 'Same message over and over', limit: 3, limitMeans: 'copies in 30 seconds' },
  invites: { label: 'Discord invite links', limit: null },
  links: { label: 'Links outside the allowlist', limit: null },
  words: { label: 'Banned words', limit: null },
  mentions: { label: 'Mass mentions', limit: 5, limitMeans: 'people mentioned in one message' },
  caps: { label: 'MOSTLY CAPS', limit: 70, limitMeans: 'percent capital letters' },
  newaccount: { label: 'Brand new accounts joining', limit: 7, limitMeans: 'minimum account age in days' },
};

export interface RuleConfig {
  rule: RuleName;
  action: RuleAction;
  limit: number | null;
  duration: number | null;
}

export interface Violation {
  rule: RuleName;
  reason: string;
}

export interface MessageFacts {
  content: string;
  mentionCount: number;
  at: number;
}

export interface Seen {
  at: number;
  content: string;
}

const SPAM_WINDOW = 5_000;
const DUPLICATE_WINDOW = 30_000;
const MIN_CAPS_LETTERS = 10;

const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const URL_HOST = /https?:\/\/([^\s/<>]+)/gi;

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Recent messages per person, kept just long enough for the spam and duplicate rules. */
export class Tracker {
  private readonly seen = new Map<string, Seen[]>();

  /** Records this message and returns the person's recent ones, including it. */
  record(key: string, facts: MessageFacts): Seen[] {
    const recent = (this.seen.get(key) ?? []).filter((s) => facts.at - s.at < DUPLICATE_WINDOW);
    recent.push({ at: facts.at, content: normalize(facts.content) });
    this.seen.set(key, recent.slice(-20));
    if (this.seen.size > 5_000) {
      for (const [k, v] of this.seen) if (v.every((s) => facts.at - s.at >= DUPLICATE_WINDOW)) this.seen.delete(k);
    }
    return recent;
  }

  forget(key: string): void {
    this.seen.delete(key);
  }
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function bannedWordIn(content: string, words: readonly string[]): string | null {
  const text = normalize(content);
  for (const word of words) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(word)}($|[^\\p{L}\\p{N}])`, 'u').test(text)) return word;
  }
  return null;
}

export function capsPercent(content: string): number {
  const letters = content.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, '').replace(/[^\p{L}]/gu, '');
  if (letters.length < MIN_CAPS_LETTERS) return 0;
  const upper = [...letters].filter((c) => c !== c.toLowerCase()).length;
  return Math.round((upper / letters.length) * 100);
}

export interface CheckInput {
  facts: MessageFacts;
  history: readonly Seen[];
  rules: ReadonlyMap<RuleName, RuleConfig>;
  words: readonly string[];
  allowedDomains: readonly string[];
}

const limitOf = (config: RuleConfig): number => config.limit ?? RULE_INFO[config.rule].limit ?? 0;

/** The first rule this message breaks, checked from most to least blatant. */
export function findViolation({ facts, history, rules, words, allowedDomains }: CheckInput): Violation | null {
  const on = (rule: RuleName) => rules.get(rule);

  if (on('words') && words.length > 0) {
    const word = bannedWordIn(facts.content, words);
    if (word) return { rule: 'words', reason: 'Used a banned word' };
  }
  if (on('invites') && INVITE.test(facts.content)) return { rule: 'invites', reason: 'Posted a Discord invite' };
  if (on('links')) {
    for (const [, host] of facts.content.matchAll(URL_HOST)) {
      if (!hostAllowed(host!, allowedDomains)) return { rule: 'links', reason: `Posted a link (${host})` };
    }
  }
  const mentions = on('mentions');
  if (mentions && facts.mentionCount >= limitOf(mentions)) {
    return { rule: 'mentions', reason: `Mentioned ${facts.mentionCount} people` };
  }
  const caps = on('caps');
  if (caps && capsPercent(facts.content) >= limitOf(caps)) return { rule: 'caps', reason: 'Too many caps' };

  const duplicates = on('duplicates');
  if (duplicates && facts.content.trim()) {
    const same = normalize(facts.content);
    const copies = history.filter((s) => s.content === same && facts.at - s.at < DUPLICATE_WINDOW).length;
    if (copies >= limitOf(duplicates)) return { rule: 'duplicates', reason: `Sent the same message ${copies} times` };
  }
  const spam = on('spam');
  if (spam) {
    const burst = history.filter((s) => facts.at - s.at < SPAM_WINDOW).length;
    if (burst >= limitOf(spam)) return { rule: 'spam', reason: `Sent ${burst} messages in 5 seconds` };
  }
  return null;
}

/** Whether a new account is too young to join, per the newaccount rule. */
export function tooNew(accountCreated: Date, minDays: number, now = new Date()): boolean {
  return now.getTime() - accountCreated.getTime() < minDays * 86_400_000;
}
