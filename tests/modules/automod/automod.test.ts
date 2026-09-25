import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Tracker,
  bannedWordIn,
  capsPercent,
  findViolation,
  hostAllowed,
  tooNew,
  type RuleConfig,
  type RuleName,
} from '../../../src/modules/automod/lib/engine.js';
import { isExempt } from '../../../src/modules/automod/lib/enforce.js';
import { editList, getAutomod, setRule } from '../../../src/modules/automod/lib/settings.js';
import { resetDb } from '../../db.js';

const G = 'g1';

beforeEach(resetDb);

const rules = (...names: RuleName[]): Map<RuleName, RuleConfig> =>
  new Map(names.map((rule) => [rule, { rule, action: 'delete', limit: null, duration: null }]));

const check = (content: string, on: RuleName[], extra: Partial<Parameters<typeof findViolation>[0]> = {}) =>
  findViolation({
    facts: { content, mentionCount: 0, at: 1_000 },
    history: [{ at: 1_000, content }],
    rules: rules(...on),
    words: [],
    allowedDomains: [],
    ...extra,
  });

describe('rule helpers', () => {
  it('matches banned words on word boundaries, phrases included', () => {
    expect(bannedWordIn('you are a Noob!', ['noob'])).toBe('noob');
    expect(bannedWordIn('snoobish', ['noob'])).toBeNull();
    expect(bannedWordIn('buy  cheap  pills', ['cheap pills'])).toBe('cheap pills');
  });

  it('counts caps on letters only, ignoring short messages, mentions, and links', () => {
    expect(capsPercent('OK')).toBe(0);
    expect(capsPercent('THIS IS SO LOUD')).toBe(100);
    expect(capsPercent('<@123> hello there friend https://X.COM')).toBe(0);
  });

  it('allows domains and their subdomains', () => {
    expect(hostAllowed('www.youtube.com', ['youtube.com'])).toBe(true);
    expect(hostAllowed('music.youtube.com', ['youtube.com'])).toBe(true);
    expect(hostAllowed('notyoutube.com', ['youtube.com'])).toBe(false);
  });

  it('spots new accounts', () => {
    const now = new Date('2026-09-24T00:00:00Z');
    expect(tooNew(new Date('2026-09-20T00:00:00Z'), 7, now)).toBe(true);
    expect(tooNew(new Date('2026-09-01T00:00:00Z'), 7, now)).toBe(false);
  });
});

describe('findViolation', () => {
  it('ignores rules that are off', () => {
    expect(check('discord.gg/abc https://x.com FREE STUFF FOR ALL', [])).toBeNull();
  });

  it('catches words, invites, and links outside the allowlist', () => {
    expect(check('hey noob', ['words'], { words: ['noob'] })?.rule).toBe('words');
    expect(check('join discord.gg/abc', ['invites'])?.rule).toBe('invites');
    expect(check('see https://evil.com/x', ['links'])).toEqual({ rule: 'links', reason: 'Posted a link (evil.com)' });
    expect(check('see https://youtube.com/x', ['links'], { allowedDomains: ['youtube.com'] })).toBeNull();
  });

  it('uses rule limits for mentions and caps, with defaults', () => {
    const base = { facts: { content: 'hi', mentionCount: 5, at: 0 }, history: [], words: [], allowedDomains: [] };
    expect(findViolation({ ...base, rules: rules('mentions') })?.rule).toBe('mentions');
    const loose = new Map([['mentions', { rule: 'mentions', action: 'delete', limit: 10, duration: null }]]) as Map<RuleName, RuleConfig>;
    expect(findViolation({ ...base, rules: loose })).toBeNull();
    expect(check('WHY IS EVERYONE YELLING', ['caps'])?.rule).toBe('caps');
  });

  it('tracks spam and duplicates per person', () => {
    const tracker = new Tracker();
    const on = rules('spam', 'duplicates');
    const send = (content: string, at: number) => {
      const facts = { content, mentionCount: 0, at };
      return findViolation({ facts, history: tracker.record('u', facts), rules: on, words: [], allowedDomains: [] });
    };
    expect(send('buy now', 0)).toBeNull();
    expect(send('buy now', 10_000)).toBeNull();
    expect(send('Buy  now', 20_000)).toEqual({ rule: 'duplicates', reason: 'Sent the same message 3 times' });
    tracker.forget('u');
    for (let i = 0; i < 4; i++) expect(send(`msg ${i}`, 100_000 + i * 100)).toBeNull();
    expect(send('msg 5', 100_500)?.rule).toBe('spam');
  });
});

describe('settings', () => {
  it('only loads enabled rules and keeps lists', async () => {
    await setRule(G, 'spam', { enabled: true, action: 'timeout', limit: 4, duration: 60 });
    await setRule(G, 'caps', { enabled: false });
    await editList(G, 'bannedWords', ['noob', 'cheap pills'], true);
    await editList(G, 'allowedDomains', ['youtube.com'], true);
    await editList(G, 'bannedWords', ['noob'], false);
    const config = await getAutomod(G);
    expect([...config.rules.keys()]).toEqual(['spam']);
    expect(config.rules.get('spam')).toEqual({ rule: 'spam', action: 'timeout', limit: 4, duration: 60 });
    expect(config.words).toEqual(['cheap pills']);
    expect(config.allowedDomains).toEqual(['youtube.com']);
  });
});

describe('isExempt', () => {
  const member = (canManage: boolean, roles: string[] = []) => ({
    permissions: { has: (p: bigint) => canManage && p === PermissionFlagsBits.ManageMessages },
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
  });
  const config = { exemptRoles: new Set(['vip']), exemptChannels: new Set(['memes']) };

  it('skips mods, exempt roles, and exempt channels or their threads', () => {
    expect(isExempt(config, member(true) as never, ['general'])).toBe(true);
    expect(isExempt(config, member(false, ['vip']) as never, ['general'])).toBe(true);
    expect(isExempt(config, member(false) as never, ['thread', 'memes'])).toBe(true);
    expect(isExempt(config, member(false) as never, ['general'])).toBe(false);
  });
});
