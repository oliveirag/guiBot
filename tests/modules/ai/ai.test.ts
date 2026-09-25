import { EmbedBuilder } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cooldowns } from '../../../src/core/cooldowns.js';
import { prisma } from '../../../src/db.js';
import { parseEnv, parseGemini } from '../../../src/env.js';
import { buildPrompt, projectSnapshot, transcript } from '../../../src/modules/ai/lib/context.js';
import { digestText, withStatusParagraph } from '../../../src/modules/ai/lib/digest.js';
import { GeminiError, createGemini, type FetchLike } from '../../../src/modules/ai/lib/gemini.js';
import { toChatLines } from '../../../src/modules/ai/lib/history.js';
import { PERSONA, systemPrompt } from '../../../src/modules/ai/lib/persona.js';
import { answer, checkGate, failureMessage, forDiscord } from '../../../src/modules/ai/lib/reply.js';
import { getAiConfig, setAiChannel, setAiCooldown } from '../../../src/modules/ai/lib/settings.js';
import { isForBot, stripMention } from '../../../src/modules/ai/events/mention.js';
import { resetDb } from '../../db.js';

const G = 'g1';
const JIRA = { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', token: 't' };

beforeEach(resetDb);

describe('parseGemini', () => {
  it('is unset without a key and defaults the model', () => {
    expect(parseGemini({})).toBeUndefined();
    expect(parseGemini({ GEMINI_API_KEY: ' "abc def"\n' })).toEqual({ apiKey: 'abcdef', model: 'gemini-2.5-flash' });
    expect(parseGemini({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x' })?.model).toBe('gemini-x');
  });

  it('is part of parseEnv', () => {
    expect(parseEnv({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', GEMINI_API_KEY: 'k' }).gemini?.apiKey).toBe('k');
  });
});

describe('createGemini', () => {
  const ok = (body: unknown): ReturnType<FetchLike> => Promise.resolve({ ok: true, status: 200, json: async () => body });

  it('sends the system prompt and returns joined text', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => ok({ candidates: [{ content: { parts: [{ text: 'Hey ' }, { text: 'bro' }] } }] }));
    const generate = createGemini({ apiKey: 'key', model: 'm' }, fetchImpl);
    expect(await generate({ system: 'sys', prompt: 'hi' })).toBe('Hey bro');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/models/m:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('key');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });

  it('throws GeminiError on http errors, blocks, and empty answers', async () => {
    const busy = createGemini({ apiKey: 'k', model: 'm' }, () => Promise.resolve({ ok: false, status: 429, json: async () => ({}) }));
    await expect(busy({ system: 's', prompt: 'p' })).rejects.toMatchObject({ status: 429, busy: true });
    const blocked = createGemini({ apiKey: 'k', model: 'm' }, () => ok({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(blocked({ system: 's', prompt: 'p' })).rejects.toBeInstanceOf(GeminiError);
    const empty = createGemini({ apiKey: 'k', model: 'm' }, () => ok({ candidates: [] }));
    await expect(empty({ system: 's', prompt: 'p' })).rejects.toThrow(/empty/);
  });
});

describe('prompt building', () => {
  it('keeps the newest lines that fit, oldest first', () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ author: `u${i}`, content: 'x'.repeat(300) }));
    const text = transcript(lines);
    expect(text.split('\n').at(-1)).toMatch(/^u29:/);
    expect(text).not.toContain('u0:');
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('adds the question after the chat', () => {
    expect(buildPrompt([], 'Gui', 'yo')).toBe('Gui says to you: yo');
    const prompt = buildPrompt([{ author: 'Ana', content: 'hi\nthere' }], 'Gui', '');
    expect(prompt).toContain('Ana: hi there');
    expect(prompt).toMatch(/Gui says to you: \(just pinged you\)$/);
  });

  it('adds project context to the persona only when there is some', () => {
    expect(systemPrompt(null)).toBe(PERSONA);
    expect(systemPrompt('sprint stuff')).toContain('sprint stuff');
  });

  it('turns channel messages into lines, skipping other bots', () => {
    const msg = (id: string, bot: boolean, content: string, t: number, name = id) =>
      ({ author: { id, bot, username: name, displayName: name }, member: null, content, createdTimestamp: t }) as never;
    const lines = toChatLines([msg('b', true, 'me', 2), msg('x', true, 'spam', 3), msg('u', false, 'hey', 1)], 'b');
    expect(lines).toEqual([
      { author: 'u', content: 'hey' },
      { author: 'guiBot (you)', content: 'me' },
    ]);
  });
});

describe('projectSnapshot', () => {
  it('is null when the server tracks nothing', async () => {
    expect(await projectSnapshot(G, undefined)).toBeNull();
  });

  it('includes sprint, deadlines, and recent dev events', async () => {
    const now = new Date('2026-09-24T12:00:00Z');
    await prisma.devFeed.create({ data: { guildId: G, source: 'jira', key: 'SD', channelId: 'c' } });
    await prisma.sdDeadline.create({
      data: { guildId: G, title: 'Design doc', dueAt: new Date('2026-09-30T23:59:00Z'), createdBy: 'u' },
    });
    await prisma.devEvent.create({
      data: { deliveryId: 'd1', source: 'jira', kind: 'issue.created', key: 'SD', actorName: 'Ana', title: 'SD-4 Login' },
    });
    const loadSprint = vi.fn(async () => ({
      name: 'Sprint 2',
      goal: null,
      endDate: null,
      issues: [
        { key: 'SD-1', summary: 'Auth', status: 'In Progress', category: 'indeterminate' as const, assigneeId: null, assigneeName: 'Ana' },
        { key: 'SD-2', summary: 'Done thing', status: 'Done', category: 'done' as const, assigneeId: null, assigneeName: null },
      ],
    }));
    const snap = await projectSnapshot(G, JIRA, now, loadSprint);
    expect(loadSprint).toHaveBeenCalledWith(JIRA, 'SD');
    expect(snap).toContain('Active sprint "Sprint 2": 1/2 done (50%)');
    expect(snap).toContain('SD-1 Auth [In Progress] Ana');
    expect(snap).not.toContain('SD-2');
    expect(snap).toContain('Design doc due 2026-09-30T23:59Z');
    expect(snap).toContain('issue.created by Ana: SD-4 Login');
  });

  it('skips the sprint when Jira fails', async () => {
    await prisma.devFeed.create({ data: { guildId: G, source: 'jira', key: 'SD', channelId: 'c' } });
    const snap = await projectSnapshot(G, JIRA, new Date(), async () => {
      throw new Error('down');
    });
    expect(snap).toBeNull();
  });
});

describe('settings and gate', () => {
  it('toggles channels and cooldown', async () => {
    expect(await getAiConfig(G)).toEqual({ offChannelIds: new Set(), cooldownSeconds: 20 });
    await setAiChannel(G, 'c1', false);
    await setAiChannel(G, 'c2', false);
    await setAiChannel(G, 'c1', true);
    await setAiCooldown(G, 5);
    expect(await getAiConfig(G)).toEqual({ offChannelIds: new Set(['c2']), cooldownSeconds: 5 });
  });

  it('is on by default, blocks off channels, then cools people down, but not owners', async () => {
    await setAiChannel(G, 'c2', false);
    const cd = new Cooldowns(() => 1_000);
    expect(await checkGate(G, 'c2', 'u', [], cd)).toEqual({ allowed: false, reason: 'off' });
    expect(await checkGate(G, 'c1', 'u', [], cd)).toEqual({ allowed: true });
    expect(await checkGate(G, 'c1', 'u', [], cd)).toEqual({ allowed: false, reason: 'cooldown', left: 20 });
    expect(await checkGate(G, 'c1', 'owner', ['owner'], cd)).toEqual({ allowed: true });
    expect(await checkGate(G, 'c1', 'owner', ['owner'], cd)).toEqual({ allowed: true });
  });
});

describe('answer', () => {
  it('passes persona, context, and chat to the model and cleans the output', async () => {
    const generate = vi.fn(async (_req: { system: string; prompt: string }) => 'ok @everyone');
    const text = await answer({ guildId: G, jira: undefined, generate, history: [{ author: 'A', content: 'yo' }], asker: 'B', question: 'q' });
    expect(text).toBe('ok @​everyone');
    const req = generate.mock.calls[0]![0];
    expect(req.system).toBe(PERSONA);
    expect(req.prompt).toContain('A: yo');
  });

  it('clips to Discord length and words failures', () => {
    expect(forDiscord('a'.repeat(2500))).toHaveLength(2000);
    expect(failureMessage(new GeminiError('x', 429))).toMatch(/rate limited/);
    expect(failureMessage(new Error('x'))).toMatch(/didn't answer/);
  });
});

describe('mentions', () => {
  const message = (over: Record<string, unknown>) =>
    ({
      author: { bot: false },
      inGuild: () => true,
      mentions: { users: new Map(), repliedUser: null },
      ...over,
    }) as never;

  it('answers direct mentions and replies to the bot only', () => {
    expect(isForBot(message({ mentions: { users: new Map([['bot', {}]]), repliedUser: null } }), 'bot')).toBe(true);
    expect(isForBot(message({ mentions: { users: new Map(), repliedUser: { id: 'bot' } } }), 'bot')).toBe(true);
    expect(isForBot(message({}), 'bot')).toBe(false);
    expect(isForBot(message({ author: { bot: true }, mentions: { users: new Map([['bot', {}]]) } }), 'bot')).toBe(false);
  });

  it('strips the mention', () => {
    expect(stripMention('<@123> hey <@!123>', '123')).toBe('hey');
  });
});

describe('digest paragraph', () => {
  it('prepends the paragraph and strips markup for the model', async () => {
    const embed = new EmbedBuilder().setDescription('**3** commits <@1> <t:123:D>');
    expect(digestText(embed)).toBe('3 commits a teammate ');
    const out = await withStatusParagraph(embed, async () => 'Team is cooking.');
    expect(out.data.description).toBe('*Team is cooking.*\n\n**3** commits <@1> <t:123:D>');
  });

  it('leaves the digest alone when the model fails', async () => {
    const embed = new EmbedBuilder().setDescription('body');
    const out = await withStatusParagraph(embed, async () => {
      throw new Error('nope');
    });
    expect(out.data.description).toBe('body');
  });
});
