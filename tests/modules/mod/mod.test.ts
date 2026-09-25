import type { Guild, GuildMember, User } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setModuleEnabled } from '../../../src/core/guildConfig.js';
import { prisma } from '../../../src/db.js';
import { UserError } from '../../../src/core/errors.js';
import { messageDeleted, roleDiff, voiceMoved } from '../../../src/modules/logs/lib/render.js';
import { getRoutes, postLog, setRoute } from '../../../src/modules/logs/lib/routes.js';
import { JOB_UNBAN, punish, revoke } from '../../../src/modules/mod/lib/act.js';
import {
  activeWarns,
  caseLine,
  clearWarns,
  createCase,
  deleteWarn,
  editReason,
  madeRecently,
  renderCase,
} from '../../../src/modules/mod/lib/cases.js';
import { pickPurge } from '../../../src/modules/mod/lib/channels.js';
import { hierarchyProblem } from '../../../src/modules/mod/lib/checks.js';
import { formatDuration, parseDuration } from '../../../src/modules/mod/lib/duration.js';
import { escalationFor, updateModSettings } from '../../../src/modules/mod/lib/settings.js';
import { resetDb } from '../../db.js';
import { fakeDiscord } from '../sd/fakes.js';

const G = 'g1';

beforeEach(resetDb);

describe('durations', () => {
  it('parses compound durations and rejects junk', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('2w')).toBe(1_209_600);
    expect(() => parseDuration('soon')).toThrow(UserError);
    expect(() => parseDuration('0m')).toThrow(UserError);
  });

  it('formats the two biggest units', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(90_061)).toBe('1d 1h');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('hierarchy', () => {
  const base = { actor: { id: 'a', top: 5 }, target: { id: 't', top: 2 }, bot: { id: 'b', top: 10 }, ownerId: 'o' };

  it('allows moderating lower members', () => {
    expect(hierarchyProblem(base)).toBeNull();
  });

  it('blocks self, the bot, the owner, equals, and people above the bot', () => {
    expect(hierarchyProblem({ ...base, target: { id: 'a', top: 1 } })).toMatch(/yourself/);
    expect(hierarchyProblem({ ...base, target: { id: 'b', top: 1 } })).toMatch(/Nice try/);
    expect(hierarchyProblem({ ...base, target: { id: 'o', top: 1 } })).toMatch(/owner/);
    expect(hierarchyProblem({ ...base, target: { id: 't', top: 5 } })).toMatch(/above yours/);
    expect(hierarchyProblem({ ...base, actor: { id: 'o', top: 1 }, target: { id: 't', top: 10 } })).toMatch(/above mine/);
  });

  it("lets the owner act on anyone below the bot", () => {
    expect(hierarchyProblem({ ...base, actor: { id: 'o', top: 1 }, target: { id: 't', top: 7 } })).toBeNull();
  });
});

describe('cases', () => {
  it('numbers per guild', async () => {
    const a = await createCase({ guildId: G, action: 'warn', userId: 'u', moderatorId: 'm' });
    const b = await createCase({ guildId: G, action: 'kick', userId: 'u', moderatorId: 'm' });
    const other = await createCase({ guildId: 'g2', action: 'warn', userId: 'u', moderatorId: 'm' });
    expect([a.number, b.number, other.number]).toEqual([1, 2, 1]);
  });

  it('sets expiry from duration', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const c = await createCase({ guildId: G, action: 'ban', userId: 'u', moderatorId: 'm', duration: 3600 }, now);
    expect(c.expiresAt).toEqual(new Date('2026-01-01T01:00:00Z'));
  });

  it('removes and clears warns, but only warns', async () => {
    await createCase({ guildId: G, action: 'warn', userId: 'u', moderatorId: 'm' });
    await createCase({ guildId: G, action: 'warn', userId: 'u', moderatorId: 'm' });
    const kick = await createCase({ guildId: G, action: 'kick', userId: 'u', moderatorId: 'm' });
    await deleteWarn(G, 1);
    await expect(deleteWarn(G, 1)).rejects.toThrow(/already removed/);
    await expect(deleteWarn(G, kick.number)).rejects.toThrow(/not a warn/);
    expect(await activeWarns(G, 'u')).toHaveLength(1);
    expect(await clearWarns(G, 'u')).toBe(1);
    expect(await activeWarns(G, 'u')).toHaveLength(0);
  });

  it('edits reasons and renders', async () => {
    await createCase({ guildId: G, action: 'timeout', userId: 'u', moderatorId: 'm', duration: 600 });
    const c = await editReason(G, 1, 'spam');
    expect(renderCase(c).toJSON().title).toBe('Case #1 · Timeout');
    expect(caseLine(c)).toContain('Timeout (10m) · spam');
    await expect(editReason(G, 9, 'x')).rejects.toThrow(/no case #9/);
  });

  it('knows when a case was just made', async () => {
    await createCase({ guildId: G, action: 'ban', userId: 'u', moderatorId: 'm' });
    expect(await madeRecently(G, 'u', 'ban')).toBe(true);
    expect(await madeRecently(G, 'u', 'kick')).toBe(false);
  });
});

describe('escalation', () => {
  const s = { warnThreshold: 3, warnAction: 'timeout', warnDuration: 600 };

  it('fires exactly at the threshold', () => {
    expect(escalationFor(s, 2)).toBeNull();
    expect(escalationFor(s, 3)).toEqual({ action: 'timeout', duration: 600 });
    expect(escalationFor(s, 4)).toBeNull();
    expect(escalationFor({ ...s, warnThreshold: null }, 3)).toBeNull();
  });
});

describe('purge picking', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  const msg = (id: string, over: Partial<{ authorId: string; authorBot: boolean; content: string; age: number; pinned: boolean }> = {}) => ({
    id,
    authorId: over.authorId ?? 'u',
    authorBot: over.authorBot ?? false,
    content: over.content ?? 'hi',
    createdTimestamp: now - (over.age ?? 1000),
    pinned: over.pinned ?? false,
  });

  it('filters, skips pins and old messages, and takes the newest', () => {
    const messages = [
      msg('old', { age: 15 * 86_400_000 }),
      msg('pin', { pinned: true }),
      msg('bot', { authorBot: true, age: 10 }),
      msg('link', { content: 'see https://x.y', age: 20 }),
      msg('a', { authorId: 'target', age: 30 }),
      msg('b', { content: 'Buy NOW', age: 40 }),
    ];
    expect(pickPurge(messages, {}, 3, now)).toEqual(['bot', 'link', 'a']);
    expect(pickPurge(messages, { bots: true }, 10, now)).toEqual(['bot']);
    expect(pickPurge(messages, { links: true }, 10, now)).toEqual(['link']);
    expect(pickPurge(messages, { userId: 'target' }, 10, now)).toEqual(['a']);
    expect(pickPurge(messages, { match: 'buy now' }, 10, now)).toEqual(['b']);
  });
});

describe('log rendering', () => {
  it('diffs roles and describes voice moves', () => {
    expect(roleDiff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    const u = { id: 'u', tag: 'u#0' };
    expect(voiceMoved(u, 'x', 'x')).toBeNull();
    expect(voiceMoved(u, null, 'v')!.toJSON().title).toBe('Joined voice');
    expect(voiceMoved(u, 'v', null)!.toJSON().title).toBe('Left voice');
    expect(voiceMoved(u, 'v', 'w')!.toJSON().description).toContain('<#v> → <#w>');
  });

  it("says when a deleted message wasn't cached", () => {
    const embed = messageDeleted({ author: null, channelId: 'c', content: null, attachments: [], createdAt: null }).toJSON();
    expect(embed.fields?.[0]?.value).toMatch(/Not cached/);
  });
});

describe('log routes', () => {
  it('sets, clears, and posts only when routed and enabled', async () => {
    await setRoute(G, 'modlog', 'c1');
    expect((await getRoutes(G)).get('modlog')).toBe('c1');
    const { client, sent } = fakeDiscord();

    await postLog(client, G, 'messages', { content: 'x' });
    expect(sent).toHaveLength(0);
    await postLog(client, G, 'modlog', { content: 'x' });
    expect(sent).toHaveLength(1);

    await setModuleEnabled(G, 'logs', false);
    await postLog(client, G, 'modlog', { content: 'y' });
    expect(sent).toHaveLength(1);

    await setRoute(G, 'modlog', null);
    expect((await getRoutes(G)).has('modlog')).toBe(false);
  });
});

function fakeGuild() {
  const { client, sent } = fakeDiscord();
  Object.assign(client, { user: { id: 'bot' } });
  const guild = {
    id: G,
    name: 'Test',
    client,
    members: { ban: vi.fn(async () => {}) },
    bans: { remove: vi.fn(async () => {}) },
  };
  return { guild: guild as unknown as Guild, raw: guild, sent };
}

const fakeUser = (dmFails = false) =>
  ({
    id: 'u',
    tag: 'user#0',
    send: vi.fn(async () => {
      if (dmFails) throw new Error('closed');
    }),
  }) as unknown as User & { send: ReturnType<typeof vi.fn> };

function fakeMember(timedOut = false) {
  return {
    kick: vi.fn(async () => {}),
    timeout: vi.fn(async () => {}),
    isCommunicationDisabled: () => timedOut,
  } as unknown as GuildMember & { kick: ReturnType<typeof vi.fn>; timeout: ReturnType<typeof vi.fn> };
}

const mod = { id: 'm', name: 'mod' };

describe('punish', () => {
  it('bans temporarily: DMs, bans, records, schedules the unban, and logs', async () => {
    await setRoute(G, 'modlog', 'log');
    const { guild, raw, sent } = fakeGuild();
    const user = fakeUser();
    const result = await punish({ guild, target: user, member: null, moderator: mod, action: 'ban', reason: 'spam', duration: 86_400 });
    expect(user.send).toHaveBeenCalledOnce();
    expect(raw.members.ban).toHaveBeenCalledWith('u', { reason: 'mod: spam', deleteMessageSeconds: 0 });
    expect(result.case).toMatchObject({ number: 1, action: 'ban', reason: 'spam', duration: 86_400 });
    expect(result.dmed).toBe(true);
    expect(await prisma.job.count({ where: { type: JOB_UNBAN } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await prisma.modCase.findFirst())?.logMessageId).toMatch(/^m/);
  });

  it('needs a member and a duration for timeouts', async () => {
    const { guild } = fakeGuild();
    await expect(punish({ guild, target: fakeUser(), member: null, moderator: mod, action: 'kick', reason: null })).rejects.toThrow(/not in this server/);
    await expect(
      punish({ guild, target: fakeUser(), member: fakeMember(), moderator: mod, action: 'timeout', reason: null }),
    ).rejects.toThrow(/28 days/);
  });

  it("skips DMs when they're off and reports failed DMs", async () => {
    const { guild } = fakeGuild();
    const failed = await punish({ guild, target: fakeUser(true), member: null, moderator: mod, action: 'warn', reason: 'a' });
    expect(failed.dmed).toBe(false);
    await updateModSettings(G, { dmOnAction: false });
    const user = fakeUser();
    const off = await punish({ guild, target: user, member: null, moderator: mod, action: 'warn', reason: 'b' });
    expect(off.dmed).toBeNull();
    expect(user.send).not.toHaveBeenCalled();
  });

  it('escalates at the warn threshold', async () => {
    await updateModSettings(G, { warnThreshold: 2, warnAction: 'timeout', warnDuration: null });
    const { guild } = fakeGuild();
    const member = fakeMember();
    const input = { guild, target: fakeUser(), member, moderator: mod, action: 'warn' as const, reason: 'x' };
    expect((await punish(input)).escalated).toBeNull();
    const second = await punish(input);
    expect(second.escalated).toMatchObject({ action: 'timeout', moderatorId: 'bot', duration: 3600, reason: 'Reached 2 warnings' });
    expect(member.timeout).toHaveBeenCalledWith(3_600_000, 'guiBot: Reached 2 warnings');
  });
});

describe('revoke', () => {
  it('unbans and ends the active ban case', async () => {
    const { guild } = fakeGuild();
    await punish({ guild, target: fakeUser(), member: null, moderator: mod, action: 'ban', reason: null, duration: 60 });
    const c = await revoke({ guild, userId: 'u', userTag: 'user#0', member: null, moderator: mod, action: 'unban', reason: null });
    expect(c.action).toBe('unban');
    expect((await prisma.modCase.findFirst({ where: { action: 'ban' } }))?.active).toBe(false);
  });

  it("won't untimeout someone who isn't timed out", async () => {
    const { guild } = fakeGuild();
    await expect(
      revoke({ guild, userId: 'u', userTag: null, member: fakeMember(false), moderator: mod, action: 'untimeout', reason: null }),
    ).rejects.toThrow(/aren't timed out/);
  });
});
