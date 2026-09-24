import type { Prisma, SdSettings } from '@prisma/client';
import { prisma } from '../../../db.js';
import { DEFAULT_TIMEZONE } from './time.js';

export type SettingsPatch = Partial<Omit<SdSettings, 'guildId' | 'updatedAt'>>;

export function defaultSettings(guildId: string): SdSettings {
  return {
    guildId,
    timezone: DEFAULT_TIMEZONE,
    deadlineChannelId: null,
    boardMessageId: null,
    standupChannelId: null,
    standupTime: '10:00',
    standupDays: '1,2,3,4,5',
    standupWindowHours: 4,
    standupVersion: 0,
    digestChannelId: null,
    digestDay: 5,
    digestTime: '17:00',
    digestVersion: 0,
    aiDigest: false,
    updatedAt: new Date(0),
  };
}

export async function getSettings(guildId: string, db: Prisma.TransactionClient = prisma): Promise<SdSettings> {
  return (await db.sdSettings.findUnique({ where: { guildId } })) ?? defaultSettings(guildId);
}

export function updateSettings(
  guildId: string,
  patch: SettingsPatch,
  db: Prisma.TransactionClient = prisma,
): Promise<SdSettings> {
  return db.sdSettings.upsert({ where: { guildId }, create: { guildId, ...patch }, update: patch });
}
