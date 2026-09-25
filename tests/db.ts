import { prisma } from '../src/db.js';
import { clearGuildConfigCache } from '../src/core/guildConfig.js';
import { clearAutomodCache } from '../src/modules/automod/lib/settings.js';
import { clearLogCache } from '../src/modules/logs/lib/routes.js';

export async function resetDb(): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.aiSettings.deleteMany();
  await prisma.modCase.deleteMany();
  await prisma.modNote.deleteMany();
  await prisma.modSettings.deleteMany();
  await prisma.logRoute.deleteMany();
  await prisma.automodRule.deleteMany();
  await prisma.automodSettings.deleteMany();
  await prisma.rolePanelOption.deleteMany();
  await prisma.rolePanel.deleteMany();
  await prisma.reactionRole.deleteMany();
  await prisma.autoRole.deleteMany();
  await prisma.welcomeSettings.deleteMany();
  await prisma.suggestionVote.deleteMany();
  await prisma.suggestion.deleteMany();
  await prisma.suggestionSettings.deleteMany();
  clearLogCache();
  clearAutomodCache();
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
