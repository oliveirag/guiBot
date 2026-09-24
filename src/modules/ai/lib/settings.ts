import { prisma } from '../../../db.js';

export const DEFAULT_COOLDOWN = 20;
export const MAX_AI_CHANNELS = 25;

export interface AiConfig {
  channelIds: ReadonlySet<string>;
  cooldownSeconds: number;
}

const parse = (csv: string): Set<string> => new Set(csv.split(',').filter(Boolean));

export async function getAiConfig(guildId: string): Promise<AiConfig> {
  const row = await prisma.aiSettings.findUnique({ where: { guildId } });
  return { channelIds: parse(row?.channelIds ?? ''), cooldownSeconds: row?.cooldownSeconds ?? DEFAULT_COOLDOWN };
}

/** Turns AI on or off in one channel. Returns the channels it's on in afterwards. */
export async function setAiChannel(guildId: string, channelId: string, on: boolean): Promise<ReadonlySet<string>> {
  const next = new Set((await getAiConfig(guildId)).channelIds);
  if (on) next.add(channelId);
  else next.delete(channelId);
  if (next.size > MAX_AI_CHANNELS) throw new RangeError(`AI can be on in at most ${MAX_AI_CHANNELS} channels`);
  const channelIds = [...next].join(',');
  await prisma.aiSettings.upsert({ where: { guildId }, create: { guildId, channelIds }, update: { channelIds } });
  return next;
}

export async function setAiCooldown(guildId: string, cooldownSeconds: number): Promise<void> {
  await prisma.aiSettings.upsert({
    where: { guildId },
    create: { guildId, cooldownSeconds },
    update: { cooldownSeconds },
  });
}
