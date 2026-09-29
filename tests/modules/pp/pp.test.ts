import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { setModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildServer } from '../../../src/core/http.js';
import { prisma } from '../../../src/db.js';
import { parseLineups, type Slip } from '../../../src/modules/pp/lib/lineups.js';
import { pickLine, slipEmbed } from '../../../src/modules/pp/lib/render.js';
import {
  ingestSlips,
  lastWatcherCheckIn,
  listTracks,
  parseProfileId,
  trackProfile,
  untrackProfile,
  watchedProfiles,
} from '../../../src/modules/pp/lib/tracks.js';
import watcherRoutes from '../../../src/modules/pp/routes/watcher.js';
import { resetDb } from '../../db.js';
import { silentLog, testEnv } from '../../helpers.js';
import { apiError, embeds, fakeDiscord } from '../sd/fakes.js';

const G = 'g1';
const P = 'go0QDE3G';
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/pp/lineups.json', import.meta.url), 'utf8'));

beforeEach(resetDb);

/** The fixture with its one slip copied under new ids, placed later. */
function withExtraSlip(id: string, createdAt = '2026-09-29T12:00:00.000-04:00') {
  const copy = structuredClone(fixture);
  copy.data.push({ ...copy.data[0], id, attributes: { ...copy.data[0].attributes, created_at: createdAt } });
  return copy;
}

const track = (guildId = G, channelId = 'c1') => trackProfile({ guildId, profileId: P, channelId, addedById: 'u' });

describe('parsing lineups', () => {
  it('reads a real slip', () => {
    const [slip, ...rest] = parseLineups(fixture);
    expect(rest).toHaveLength(0);
    expect(slip).toMatchObject({
      id: '1793067262',
      entryCents: 1000,
      toWinCents: 6000,
      multiplier: 6,
      playType: 'Power Play',
      freePlay: false,
      sport: 'WNBA1H',
    });
    expect(slip!.createdAt).toEqual(new Date('2026-09-29T06:52:37.606Z'));
    expect(slip!.picks.map((p) => [p.player, p.team, p.direction, p.line, p.stat, p.context])).toEqual([
      ['Natasha Howard', 'MIN', 'more', 5.5, 'Points', 'NYL 1st Half'],
      ["A'ja Wilson", 'LVA', 'more', 27, 'Fantasy Score', 'IND 1st Half'],
      ['Paige Bueckers', 'DAL', 'more', 14.5, 'PRA', 'GSV 1st Half'],
    ]);
  });

  it('calls multi-payout slips flex, sorts oldest first, and skips junk', () => {
    const raw = withExtraSlip('2', '2026-09-28T00:00:00Z');
    raw.data[1].attributes.payouts = { '3': { multiplier: 3 }, '2': { multiplier: 1 } };
    raw.data.push({ type: 'new_wager', id: 'no-date', attributes: {} }, { type: 'other', id: 'x' }, null);
    const slips = parseLineups(raw);
    expect(slips.map((s) => [s.id, s.playType])).toEqual([
      ['2', 'Flex Play'],
      ['1793067262', 'Power Play'],
    ]);
    expect(parseLineups(null)).toEqual([]);
    expect(parseLineups({ data: 'nope' })).toEqual([]);
    expect(parseLineups({ data: [] })).toEqual([]);
  });
});

describe('slip card', () => {
  const [slip] = parseLineups(fixture) as [Slip];

  it('shows the picks, money, and who placed it', () => {
    const [e] = embeds({ embeds: [slipEmbed(slip, { profileId: P, username: 'JerimiaFrasier', avatarUrl: 'https://x/a.png' })] });
    expect(e?.author).toMatchObject({ name: 'JerimiaFrasier', url: `https://app.prizepicks.com/p/${P}/open-lineups` });
    expect(e?.title).toBe('New 3-pick Power Play');
    expect(e?.fields?.map((f) => [f.name, f.value])).toEqual([
      ['Entry', '$10'],
      ['To win', '$60 (6x)'],
      ['Placed', `<t:${Math.floor(slip.createdAt.getTime() / 1000)}:R>`],
    ]);
    expect(e?.description?.split('\n')).toHaveLength(6);
    expect(e?.footer?.text).toBe('PrizePicks · WNBA1H · slip 1793067262');
  });

  it('formats one pick', () => {
    const line = pickLine({
      player: 'Ana',
      team: 'NYL',
      direction: 'less',
      line: 2.5,
      stat: '3PM',
      context: 'LVA',
      startsAt: new Date('2026-09-29T20:00:00Z'),
      oddsType: 'demon',
    });
    expect(line).toBe('**Ana** NYL · ⬇️ Less **2.5** 3PM 😈\n-# vs LVA · <t:1790712000:f>');
    expect(slipEmbed({ ...slip, entryCents: 1050, freePlay: true }, { profileId: P, username: null, avatarUrl: null }).toJSON()).toMatchObject({
      author: { name: P },
      title: 'New 3-pick Power Play (free)',
      fields: [{ value: '$10.50' }, {}, {}],
    });
  });
});

describe('tracking', () => {
  it('parses share links and bare ids', () => {
    expect(parseProfileId('https://app.prizepicks.com/p/go0QDE3G/open-lineups')).toBe(P);
    expect(parseProfileId('prizepicks.com/p/VzYfrl6a')).toBe('VzYfrl6a');
    expect(parseProfileId(' go0QDE3G ')).toBe(P);
    expect(() => parseProfileId('https://example.com/x')).toThrow(/not a PrizePicks profile/);
  });

  it('tracks, moves, lists, and untracks', async () => {
    expect((await track()).moved).toBe(false);
    expect((await track(G, 'c2')).moved).toBe(true);
    await track('g2');
    expect((await listTracks(G)).map((t) => t.channelId)).toEqual(['c2']);
    expect(await watchedProfiles()).toEqual([P]);
    await untrackProfile(G, P);
    await expect(untrackProfile(G, P)).rejects.toThrow(/isn't tracking/);
    expect(await listTracks(G)).toEqual([]);
  });
});

describe('ingest', () => {
  it('skips what was already open on the first check, then posts only new slips', async () => {
    await track();
    const { client, sent } = fakeDiscord();
    const first = await ingestSlips(client, P, parseLineups(fixture), { username: 'JerimiaFrasier' });
    expect(first).toEqual({ posted: 0, baselined: 1 });
    expect(sent).toHaveLength(0);

    const second = await ingestSlips(client, P, parseLineups(withExtraSlip('new-1')));
    expect(second).toEqual({ posted: 1, baselined: 0 });
    expect(sent[0]?.channelId).toBe('c1');
    expect(embeds(sent[0]!.message)[0]?.author?.name).toBe('JerimiaFrasier');

    expect(await ingestSlips(client, P, parseLineups(withExtraSlip('new-1')))).toEqual({ posted: 0, baselined: 0 });
    expect(sent).toHaveLength(1);
  });

  it('posts to every guild tracking the profile, unless pp is off there', async () => {
    await track(G, 'c1');
    await track('g2', 'c2');
    await track('g3', 'c3');
    await setModuleEnabled('g3', 'pp', false);
    const { client, sent } = fakeDiscord();
    await ingestSlips(client, P, []);
    await ingestSlips(client, P, parseLineups(fixture));
    expect(sent.map((s) => s.channelId).sort()).toEqual(['c1', 'c2']);
  });

  it("doesn't retry a slip whose channel is gone", async () => {
    await track(G, 'gone');
    const { client, sent } = fakeDiscord({ gone: apiError(10003) });
    await ingestSlips(client, P, []);
    expect(await ingestSlips(client, P, parseLineups(fixture))).toEqual({ posted: 0, baselined: 0 });
    expect(await prisma.ppSeen.count()).toBe(1);
    expect(sent).toHaveLength(0);
  });
});

describe('watcher routes', () => {
  const TOKEN = 'watch-secret';
  const app = (token: string | null = TOKEN) => {
    const { client, sent } = fakeDiscord();
    return { server: buildServer({ routes: [watcherRoutes], deps: { env: testEnv({ ppWatcherToken: token ?? undefined }), log: silentLog(), client } }), sent };
  };
  const auth = { authorization: `Bearer ${TOKEN}` };

  it('needs the token', async () => {
    expect((await app(null).server.inject({ method: 'GET', url: '/pp/profiles', headers: auth })).statusCode).toBe(503);
    const { server } = app();
    expect((await server.inject({ method: 'GET', url: '/pp/profiles' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/pp/profiles', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });

  it('lists profiles and takes lineups end to end', async () => {
    await track();
    const { server, sent } = app();
    const profiles = await server.inject({ method: 'GET', url: '/pp/profiles', headers: auth });
    expect(profiles.json()).toEqual({ profiles: [P] });
    expect(lastWatcherCheckIn()).not.toBeNull();

    const post = (lineups: unknown) =>
      server.inject({ method: 'POST', url: '/pp/lineups', headers: auth, payload: { profileId: P, profile: { username: 'J' }, lineups } });
    expect((await post(fixture)).json()).toEqual({ slips: 1, posted: 0, baselined: 1 });
    expect((await post(withExtraSlip('new-1'))).json()).toEqual({ slips: 2, posted: 1, baselined: 0 });
    expect(sent).toHaveLength(1);
    expect((await server.inject({ method: 'POST', url: '/pp/lineups', headers: auth, payload: { profileId: '../x' } })).statusCode).toBe(400);
  });
});
