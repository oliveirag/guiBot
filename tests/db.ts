import { prisma } from '../src/db.js';
import { clearGuildConfigCache } from '../src/core/guildConfig.js';

export async function resetDb(): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.sdRsvp.deleteMany();
  await prisma.sdMeeting.deleteMany();
  await prisma.sdStandupEntry.deleteMany();
  await prisma.sdStandup.deleteMany();
  await prisma.sdDeadline.deleteMany();
  await prisma.sdMember.deleteMany();
  await prisma.sdSettings.deleteMany();
  await prisma.devEvent.deleteMany();
  await prisma.devFeed.deleteMany();
  await prisma.devSettings.deleteMany();
  await prisma.guildConfig.deleteMany();
  clearGuildConfigCache();
}
