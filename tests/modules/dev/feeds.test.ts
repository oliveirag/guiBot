import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db.js';
import { UserError } from '../../../src/core/errors.js';
import {
  MAX_FEEDS_PER_GUILD,
  addFeed,
  canPost,
  describeFeeds,
  feedTargets,
  listFeeds,
  normalizeTarget,
  removeFeed,
  removeFeedsForChannel,
} from '../../../src/modules/dev/lib/feeds.js';
import { resetDb } from '../../db.js';

describe('normalizeTarget', () => {
  it('lowercases GitHub repos and accepts pasted URLs', () => {
    expect(normalizeTarget('github', 'oliveirag/guiBot')).toBe('oliveirag/guibot');
    expect(normalizeTarget('github', ' https://github.com/oliveirag/guiBot.git/ ')).toBe('oliveirag/guibot');
  });

  it('accepts the ways people actually paste a repo, including org repos', () => {
    for (const raw of [
      'sducf/zaklang',
      'github.com/sducf/zaklang',
      'https://www.github.com/sducf/zaklang',
      'https://github.com/sducf/zaklang/tree/main',
      '<https://github.com/sducf/zaklang>',
      'git@github.com:sducf/zaklang.git',
      'sducf / zaklang',
    ]) {
      expect(normalizeTarget('github', raw), raw).toBe('sducf/zaklang');
    }
  });

  it('explains that a bare repo name needs its owner', () => {
    expect(() => normalizeTarget('github', 'zaklang')).toThrow(/sducf\/zaklang|owner\/name/);
  });

  it('uppercases Jira project keys', () => {
    expect(normalizeTarget('jira', 'sd')).toBe('SD');
  });

  it('rejects things that are not a repo or project key', () => {
    expect(() => normalizeTarget('github', 'guiBot')).toThrow(UserError);
    expect(() => normalizeTarget('jira', 'SD-12')).toThrow(UserError);
    expect(() => normalizeTarget('jira', '1SD')).toThrow(UserError);
  });
});

describe('feeds', () => {
  beforeEach(resetDb);

  it('adds a feed and moves it when added again with another channel', async () => {
    expect(await addFeed('g1', 'github', 'Owner/Repo', 'c1')).toEqual({ key: 'owner/repo', moved: false });
    expect(await addFeed('g1', 'github', 'owner/repo', 'c2')).toEqual({ key: 'owner/repo', moved: true });
    const feeds = await listFeeds('g1');
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.channelId).toBe('c2');
  });

  it('caps feeds per guild', async () => {
    for (let i = 0; i < MAX_FEEDS_PER_GUILD; i++) await addFeed('g1', 'jira', `P${i}`, 'c1');
    await expect(addFeed('g1', 'jira', 'NEW', 'c1')).rejects.toThrow(/already has 25 feeds/);
    // Re-pointing an existing feed still works at the cap.
    await expect(addFeed('g1', 'jira', 'P0', 'c2')).resolves.toEqual({ key: 'P0', moved: true });
  });

  it('removes a feed and complains about missing ones', async () => {
    await addFeed('g1', 'jira', 'SD', 'c1');
    expect(await removeFeed('g1', 'jira', 'sd')).toBe('SD');
    await expect(removeFeed('g1', 'jira', 'SD')).rejects.toThrow(/No Jira feed for SD/);
  });

  it('finds every guild subscribed to a key', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g2', 'github', 'o/r', 'c2');
    await addFeed('g2', 'jira', 'SD', 'c3');
    const targets = await feedTargets('github', 'o/r');
    expect(targets.sort((a, b) => a.guildId.localeCompare(b.guildId))).toEqual([
      { guildId: 'g1', channelId: 'c1' },
      { guildId: 'g2', channelId: 'c2' },
    ]);
  });

  it('removes every feed pointing at a channel', async () => {
    await addFeed('g1', 'github', 'o/r', 'gone');
    await addFeed('g1', 'jira', 'SD', 'gone');
    await addFeed('g1', 'jira', 'OK', 'kept');
    expect(await removeFeedsForChannel('gone')).toBe(2);
    expect(await prisma.devFeed.count()).toBe(1);
  });

  it('describes feeds for /config dev list', async () => {
    expect(describeFeeds([])).toMatch(/No feeds yet/);
    await addFeed('g1', 'github', 'o/r', 'c1');
    expect(describeFeeds(await listFeeds('g1'))).toBe('GitHub **o/r** → <#c1>');
  });
});

describe('canPost', () => {
  it('needs view, send, and embed links', () => {
    const all = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]);
    expect(canPost(all)).toBe(true);
    expect(canPost(new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))).toBe(false);
    expect(canPost(null)).toBe(false);
  });
});
