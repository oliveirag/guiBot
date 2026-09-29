import { Prisma, type PpTrack } from '@prisma/client';
import type { Client } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { sendTo } from '../../sd/lib/post.js';
import type { Slip } from './lineups.js';
import { slipEmbed } from './render.js';

export const MAX_TRACKS = 25;

/** A share link (app.prizepicks.com/p/<id>/...) or the bare id. */
export function parseProfileId(input: string): string {
  const text = input.trim();
  const fromUrl = /prizepicks\.com\/p\/([A-Za-z0-9]+)/i.exec(text)?.[1];
  const id = fromUrl ?? (/^[A-Za-z0-9]{4,20}$/.test(text) ? text : null);
  if (!id) throw new UserError("That's not a PrizePicks profile. Paste the share link, like `app.prizepicks.com/p/go0QDE3G`.");
  return id;
}

export async function trackProfile(input: {
  guildId: string;
  profileId: string;
  channelId: string;
  addedById: string;
}): Promise<{ track: PpTrack; moved: boolean }> {
  const key = { guildId_profileId: { guildId: input.guildId, profileId: input.profileId } };
  const existing = await prisma.ppTrack.findUnique({ where: key });
  if (existing) {
    const track = await prisma.ppTrack.update({ where: key, data: { channelId: input.channelId } });
    return { track, moved: true };
  }
  if ((await prisma.ppTrack.count({ where: { guildId: input.guildId } })) >= MAX_TRACKS) {
    throw new UserError(`This server tracks ${MAX_TRACKS} profiles already. Untrack one first.`);
  }
  return { track: await prisma.ppTrack.create({ data: input }), moved: false };
}

export async function untrackProfile(guildId: string, profileId: string): Promise<PpTrack> {
  const found = await prisma.ppTrack.findUnique({ where: { guildId_profileId: { guildId, profileId } } });
  if (!found) throw new UserError(`This server isn't tracking \`${profileId}\`.`);
  await prisma.$transaction([
    prisma.ppTrack.delete({ where: { id: found.id } }),
    prisma.ppSeen.deleteMany({ where: { guildId, profileId } }),
  ]);
  return found;
}

export const listTracks = (guildId: string): Promise<PpTrack[]> =>
  prisma.ppTrack.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });

/** Every profile some guild tracks: what the watcher should poll. */
export async function watchedProfiles(): Promise<string[]> {
  const rows = await prisma.ppTrack.findMany({ select: { profileId: true }, distinct: ['profileId'], orderBy: { profileId: 'asc' } });
  return rows.map((r) => r.profileId);
}

// The watcher runs on Gui's Mac, so /pp list says when it last checked in.
let lastCheckIn: Date | null = null;
export const markCheckIn = (at = new Date()): void => {
  lastCheckIn = at;
};
export const lastWatcherCheckIn = (): Date | null => lastCheckIn;

export interface ProfileInfo {
  username?: string | null;
  avatarUrl?: string | null;
}

export interface IngestResult {
  posted: number;
  baselined: number;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Records a slip as handled for a guild. False when it already was. */
async function claim(guildId: string, profileId: string, wagerId: string): Promise<boolean> {
  try {
    await prisma.ppSeen.create({ data: { guildId, profileId, wagerId } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Posts slips each tracking guild hasn't seen. A guild's first poll after /pp track only records
 * what's already open, so tracking someone doesn't dump their old slips into the channel.
 */
export async function ingestSlips(client: Client, profileId: string, slips: Slip[], profile: ProfileInfo = {}): Promise<IngestResult> {
  const result: IngestResult = { posted: 0, baselined: 0 };
  const tracks = await prisma.ppTrack.findMany({ where: { profileId } });
  for (const t of tracks) {
    if (!(await isModuleEnabled(t.guildId, 'pp'))) continue;
    const info = {
      username: profile.username ?? t.username,
      avatarUrl: profile.avatarUrl ?? t.avatarUrl,
    };
    if (info.username !== t.username || info.avatarUrl !== t.avatarUrl || !t.baselined) {
      await prisma.ppTrack.update({ where: { id: t.id }, data: { ...info, baselined: true } });
    }
    if (!t.baselined) {
      for (const s of slips) await claim(t.guildId, profileId, s.id);
      result.baselined += slips.length;
      continue;
    }
    for (const s of slips) {
      if (!(await claim(t.guildId, profileId, s.id))) continue;
      const sent = await sendTo(client, t.channelId, { embeds: [slipEmbed(s, { profileId, ...info })] });
      if (sent) result.posted++;
      else log.warn(`pp: couldn't post slip ${s.id} for ${profileId} in ${t.channelId}`);
    }
  }
  return result;
}

// One ingest at a time, so two quick polls can't both claim the same slip mid-check.
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}
