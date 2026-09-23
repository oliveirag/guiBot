import { prisma } from '../src/db.js';
import { clearGuildConfigCache } from '../src/core/guildConfig.js';

export async function resetDb(): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.devEvent.deleteMany();
  await prisma.devFeed.deleteMany();
  await prisma.guildConfig.deleteMany();
  clearGuildConfigCache();
}
