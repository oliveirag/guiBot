import type { Client, EmbedBuilder, MessageCreateOptions } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../src/db.js';
import {
  JOB_GIVEAWAY_END,
  announcement,
  createGiveaway,
  drawWinners,
  entryCount,
  finishGiveaway,
  getGiveaway,
  renderGiveaway,
  rerollGiveaway,
  toggleEntry,
  winnersOf,
} from '../../../src/modules/utils/lib/giveaways.js';
import { buildPoll, parseAnswers } from '../../../src/modules/utils/lib/poll.js';
import {
  JOB_REMIND,
  MAX_ACTIVE,
  createReminder,
  deleteReminder,
  deliverReminder,
  listReminders,
  reminderLine,
} from '../../../src/modules/utils/lib/reminders.js';
import { resetDb } from '../../db.js';
import { apiError, embeds as embedsOf, fakeDiscord } from '../sd/fakes.js';

const G = 'g1';
const embeds = (view: Pick<MessageCreateOptions, 'embeds'>) => embedsOf(view as { embeds?: EmbedBuilder[] });
const NOW = new Date('2026-09-29T12:00:00Z');

beforeEach(resetDb);

/** fakeDiscord plus DMs and a guild whose members are `members`. */
function fakeClient(opts: { members?: string[]; failChannels?: Record<string, Error>; dmError?: Error } = {}) {
  const base = fakeDiscord(opts.failChannels);
  const dms: { userId: string; content: string }[] = [];
  const members = new Set(opts.members ?? []);
  Object.assign(base.client, {
    users: {
      send: vi.fn(async (userId: string, message: { content: string }) => {
        if (opts.dmError) throw opts.dmError;
        dms.push({ userId, content: message.content });
      }),
    },
    guilds: {
      cache: new Map([[G, { name: 'Test Server' }]]),
      fetch: vi.fn(async () => ({
        members: {
          fetch: vi.fn(async (id: string) => {
            if (!members.has(id)) throw apiError(10007);
            return { id };
          }),
        },
      })),
    },
  });
  return { ...base, client: base.client as Client, dms };
}

describe('poll answers', () => {
  it('splits on pipes, or commas when there are none', () => {
    expect(parseAnswers('Pizza | Tacos, extra | Sushi')).toEqual(['Pizza', 'Tacos, extra', 'Sushi']);
    expect(parseAnswers('yes, no , ')).toEqual(['yes', 'no']);
  });

  it('rejects too few, too many, too long, and duplicate answers', () => {
    expect(() => parseAnswers('just one')).toThrow(/at least 2/);
    expect(() => parseAnswers(Array.from({ length: 11 }, (_, i) => `a${i}`).join('|'))).toThrow(/max out at 10/);
    expect(() => parseAnswers(`ok | ${'x'.repeat(56)}`)).toThrow(/too long/);
    expect(() => parseAnswers('Yes | yes')).toThrow(/same/);
  });

  it('builds native poll data', () => {
    expect(buildPoll('Lunch?', ['Pizza', 'Tacos'], 24, true)).toEqual({
      question: { text: 'Lunch?' },
      answers: [{ text: 'Pizza' }, { text: 'Tacos' }],
      duration: 24,
      allowMultiselect: true,
    });
  });
});

describe('reminders', () => {
  const make = (over: Partial<Parameters<typeof createReminder>[0]> = {}) =>
    createReminder({ guildId: G, channelId: 'c1', userId: 'u1', text: 'stretch', dm: false, seconds: 600, now: NOW, ...over });

  it('schedules a job at the due time', async () => {
    const r = await make();
    expect(r.dueAt).toEqual(new Date('2026-09-29T12:10:00Z'));
    const [j] = await prisma.job.findMany({ where: { type: JOB_REMIND } });
    expect(j?.runAt).toEqual(r.dueAt);
    expect(JSON.parse(j!.payload)).toEqual({ reminderId: r.id });
  });

  it('caps length and how many you can have going', async () => {
    await expect(make({ seconds: 366 * 86_400 })).rejects.toThrow(/a year/);
    for (let i = 0; i < MAX_ACTIVE; i++) await make();
    await expect(make()).rejects.toThrow(/25 reminders/);
  });

  it('lists and deletes only your own', async () => {
    const mine = await make({ seconds: 7200 });
    const sooner = await make({ seconds: 60, dm: true });
    await make({ userId: 'u2' });
    expect((await listReminders(G, 'u1')).map((r) => r.id)).toEqual([sooner.id, mine.id]);
    expect(reminderLine(sooner)).toMatch(new RegExp(`^\\*\\*#${sooner.id}\\*\\* <t:\\d+:R> · DM · stretch$`));
    await expect(deleteReminder(G, 'u2', mine.id)).rejects.toThrow(/don't have a reminder/);
    await deleteReminder(G, 'u1', mine.id);
    expect(await listReminders(G, 'u1')).toHaveLength(1);
  });

  it('pings in the channel, then forgets it', async () => {
    const r = await make();
    const { client, sent, dms } = fakeClient();
    expect(await deliverReminder(client, r.id)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe('c1');
    expect(sent[0]!.message.content).toMatch(/^⏰ <@u1> stretch\n-# set <t:\d+:R>$/);
    expect(sent[0]!.message.allowedMentions).toEqual({ users: ['u1'] });
    expect(dms).toHaveLength(0);
    expect(await deliverReminder(client, r.id)).toBe(false);
  });

  it('DMs when asked, or when the channel is gone', async () => {
    const dmOne = await make({ dm: true });
    const lost = await make({ channelId: 'gone' });
    const { client, sent, dms } = fakeClient({ failChannels: { gone: apiError(10003) } });
    await deliverReminder(client, dmOne.id);
    await deliverReminder(client, lost.id);
    expect(sent).toHaveLength(0);
    expect(dms.map((d) => d.userId)).toEqual(['u1', 'u1']);
    expect(dms[0]!.content).toMatch(/^⏰ stretch\n-# set in Test Server/);
  });

  it('drops the reminder when DMs are closed, but retries other errors', async () => {
    const r = await make({ dm: true });
    await deliverReminder(fakeClient({ dmError: apiError(50007) }).client, r.id);
    expect(await prisma.reminder.count()).toBe(0);

    const again = await make({ dm: true });
    await expect(deliverReminder(fakeClient({ dmError: new Error('network') }).client, again.id)).rejects.toThrow('network');
    expect(await prisma.reminder.count()).toBe(1);
  });

  it('skips cancelled reminders', async () => {
    const r = await make();
    await deleteReminder(G, 'u1', r.id);
    const { client, sent } = fakeClient();
    expect(await deliverReminder(client, r.id)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('giveaways', () => {
  const make = (over: Partial<Parameters<typeof createGiveaway>[0]> = {}) =>
    createGiveaway({ guildId: G, channelId: 'c1', hostId: 'host', prize: 'Nitro', winnerCount: 1, seconds: 3600, now: NOW, ...over });
  const enter = async (id: number, ...users: string[]) => {
    for (const u of users) await toggleEntry(id, u);
  };
  // Always picks the last item, so shuffle keeps order: winners are drawn from the front.
  const rng = () => 0.999;

  it('numbers per guild, schedules its end, and checks duration', async () => {
    const g = await make();
    expect(g.number).toBe(1);
    expect((await make()).number).toBe(2);
    expect((await make({ guildId: 'g2' })).number).toBe(1);
    const jobs = await prisma.job.findMany({ where: { type: JOB_GIVEAWAY_END, guildId: G } });
    expect(jobs.map((j) => j.runAt)).toEqual([g.endsAt, g.endsAt]);
    await expect(make({ seconds: 30 })).rejects.toThrow(/at least a minute/);
    await expect(make({ seconds: 61 * 86_400 })).rejects.toThrow(/60 days/);
    await expect(getGiveaway(G, 9)).rejects.toThrow(/no giveaway #9/);
  });

  it('toggles entries', async () => {
    const g = await make();
    expect(await toggleEntry(g.id, 'a')).toBe('entered');
    expect(await toggleEntry(g.id, 'b')).toBe('entered');
    expect(await toggleEntry(g.id, 'a')).toBe('left');
    expect(await entryCount(g.id)).toBe(1);
  });

  it('draws unique winners and skips people who left', async () => {
    const eligible = async (id: string) => id !== 'b';
    expect(await drawWinners(['a', 'b', 'c', 'd'], 2, eligible, rng)).toEqual(['a', 'c']);
    expect(await drawWinners(['b'], 3, eligible, rng)).toEqual([]);
    const many = await drawWinners(['a', 'c', 'd', 'e'], 4, eligible);
    expect(new Set(many).size).toBe(4);
  });

  it('renders open and ended posts', async () => {
    const g = await make({ winnerCount: 2 });
    type Row = { toJSON(): { components: { custom_id: string; label: string; disabled?: boolean }[] } };
    const open = renderGiveaway(g, 5);
    const [openEmbed] = embeds(open);
    expect(openEmbed?.title).toBe('Nitro');
    expect(openEmbed?.description).toContain('**Winners** 2');
    expect(openEmbed?.footer?.text).toBe('Giveaway #1');
    const [button] = (open.components![0] as Row).toJSON().components;
    expect(button).toMatchObject({ custom_id: `ga:${g.id}`, label: '5' });
    expect(button?.disabled).toBeFalsy();

    const ended = renderGiveaway({ ...g, ended: true, winnerIds: 'a,b' }, 5);
    expect(embeds(ended)[0]?.description).toContain('**Winners** <@a>, <@b>');
    expect((ended.components![0] as Row).toJSON().components[0]?.disabled).toBe(true);
    expect(embeds(renderGiveaway({ ...g, ended: true }, 0))[0]?.description).toContain('nobody entered');
  });

  it('ends once: draws, redraws the post, and announces', async () => {
    const g = await make({ winnerCount: 2 });
    await prisma.giveaway.update({ where: { id: g.id }, data: { messageId: 'msg' } });
    await enter(g.id, 'a', 'left-server', 'c', 'd');
    const { client, sent, edits } = fakeClient({ members: ['a', 'c', 'd'] });

    const early = new Date(NOW.getTime() + 60_000);
    expect(await finishGiveaway(client, g.id, rng, early)).toEqual(['a', 'c']);
    const done = await getGiveaway(G, 1);
    expect(done.ended).toBe(true);
    expect(winnersOf(done)).toEqual(['a', 'c']);
    expect(done.endsAt).toEqual(early);
    expect(edits.map((e) => e.messageId)).toEqual(['msg']);
    expect(sent[0]?.message.content).toBe('🎉 Congrats <@a>, <@c>! You won **Nitro**.');
    expect(sent[0]?.message.allowedMentions).toEqual({ users: ['a', 'c'] });

    expect(await finishGiveaway(client, g.id, rng)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('says so when nobody entered', async () => {
    const g = await make();
    const { client, sent } = fakeClient();
    expect(await finishGiveaway(client, g.id)).toEqual([]);
    expect(sent[0]?.message.content).toBe('Nobody entered **Nitro**, so no winner.');
  });

  it("rerolls only from people who haven't won", async () => {
    const g = await make();
    await enter(g.id, 'a', 'b', 'c');
    const { client, sent } = fakeClient({ members: ['a', 'b', 'c'] });
    await expect(rerollGiveaway(client, g, 1)).rejects.toThrow(/still running/);

    await finishGiveaway(client, g.id, rng);
    expect(await rerollGiveaway(client, await getGiveaway(G, 1), 1, rng)).toEqual(['b']);
    expect(await rerollGiveaway(client, await getGiveaway(G, 1), 5, rng)).toEqual(['c']);
    expect(await rerollGiveaway(client, await getGiveaway(G, 1), 1, rng)).toEqual([]);
    expect(winnersOf(await getGiveaway(G, 1))).toEqual(['a', 'b', 'c']);
    expect(sent.map((s) => s.message.content)).toEqual([
      '🎉 Congrats <@a>! You won **Nitro**.',
      '🎉 New pick: <@b>! You won **Nitro**.',
      '🎉 New pick: <@c>! You won **Nitro**.',
      'Nobody else can win **Nitro**.',
    ]);
    expect(announcement('X', [], true)).toBe('Nobody else can win **X**.');
  });
});
