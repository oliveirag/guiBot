import type { DevFeed } from '@prisma/client';
import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import type { FeedSource } from './types.js';

export const SOURCE_LABEL: Record<FeedSource, string> = { github: 'GitHub', jira: 'Jira' };
export const MAX_FEEDS_PER_GUILD = 25;

const GITHUB_REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const JIRA_PROJECT = /^[A-Z][A-Z0-9_]+$/;

/** Pulls "owner/repo" out of whatever got pasted: a URL, an SSH remote, Discord's <link>, or plain text. */
function githubRepo(raw: string): string {
  const path = raw
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .replace(/^git@github\.com:/i, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/\s*\/\s*/g, '/');
  const [owner = '', repo = ''] = path.split('/').filter(Boolean);
  return `${owner}/${repo.replace(/\.git$/i, '')}`.toLowerCase();
}

export function normalizeTarget(source: FeedSource, raw: string): string {
  if (source === 'github') {
    const key = githubRepo(raw);
    if (!GITHUB_REPO.test(key)) throw new UserError('Use the repo as owner/name, like sducf/zaklang.');
    return key;
  }
  const key = raw.trim().toUpperCase();
  if (!JIRA_PROJECT.test(key)) throw new UserError('Use the Jira project key, like SD.');
  return key;
}

export async function addFeed(
  guildId: string,
  source: FeedSource,
  target: string,
  channelId: string,
): Promise<{ key: string; moved: boolean }> {
  const key = normalizeTarget(source, target);
  const where = { guildId_source_key: { guildId, source, key } };
  const existing = await prisma.devFeed.findUnique({ where });
  if (!existing && (await prisma.devFeed.count({ where: { guildId } })) >= MAX_FEEDS_PER_GUILD) {
    throw new UserError(`This server already has ${MAX_FEEDS_PER_GUILD} feeds. Remove one first.`);
  }
  await prisma.devFeed.upsert({ where, create: { guildId, source, key, channelId }, update: { channelId } });
  return { key, moved: existing !== null && existing.channelId !== channelId };
}

export async function removeFeed(guildId: string, source: FeedSource, target: string): Promise<string> {
  const key = normalizeTarget(source, target);
  const { count } = await prisma.devFeed.deleteMany({ where: { guildId, source, key } });
  if (count === 0) throw new UserError(`No ${SOURCE_LABEL[source]} feed for ${key}.`);
  return key;
}

export function listFeeds(guildId: string): Promise<DevFeed[]> {
  return prisma.devFeed.findMany({ where: { guildId }, orderBy: [{ source: 'asc' }, { key: 'asc' }] });
}

export function feedTargets(source: FeedSource, key: string): Promise<{ guildId: string; channelId: string }[]> {
  return prisma.devFeed.findMany({ where: { source, key }, select: { guildId: true, channelId: true } });
}

export async function removeFeedsForChannel(channelId: string): Promise<number> {
  return (await prisma.devFeed.deleteMany({ where: { channelId } })).count;
}

export function describeFeeds(feeds: DevFeed[]): string {
  if (feeds.length === 0) return 'No feeds yet. Add one with `/config dev add`.';
  return feeds.map((f) => `${SOURCE_LABEL[f.source as FeedSource]} **${f.key}** → <#${f.channelId}>`).join('\n');
}

export function canPost(perms: Readonly<PermissionsBitField> | null): boolean {
  return (
    perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) ??
    false
  );
}
