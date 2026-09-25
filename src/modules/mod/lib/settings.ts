import type { ModSettings } from '@prisma/client';
import { prisma } from '../../../db.js';

export type SettingsPatch = Partial<Omit<ModSettings, 'guildId' | 'updatedAt'>>;
export type Escalation = { action: 'timeout' | 'kick' | 'ban'; duration: number | null };

export const ESCALATIONS = ['timeout', 'kick', 'ban'] as const;

export async function getModSettings(guildId: string): Promise<ModSettings> {
  return (
    (await prisma.modSettings.findUnique({ where: { guildId } })) ?? {
      guildId,
      dmOnAction: true,
      warnThreshold: null,
      warnAction: null,
      warnDuration: null,
      updatedAt: new Date(0),
    }
  );
}

export function updateModSettings(guildId: string, patch: SettingsPatch): Promise<ModSettings> {
  return prisma.modSettings.upsert({ where: { guildId }, create: { guildId, ...patch }, update: patch });
}

/** What to do when someone reaches `activeWarns`. Fires once, exactly at the threshold. */
export function escalationFor(s: Pick<ModSettings, 'warnThreshold' | 'warnAction' | 'warnDuration'>, activeWarns: number): Escalation | null {
  if (!s.warnThreshold || !s.warnAction || activeWarns !== s.warnThreshold) return null;
  if (!(ESCALATIONS as readonly string[]).includes(s.warnAction)) return null;
  return { action: s.warnAction as Escalation['action'], duration: s.warnDuration };
}
