import { prisma } from '../../../db.js';

export async function getFailureRole(guildId: string): Promise<string | null> {
  const row = await prisma.devSettings.findUnique({ where: { guildId } });
  return row?.failureRoleId ?? null;
}

/** Pass null to stop pinging. */
export async function setFailureRole(guildId: string, roleId: string | null): Promise<void> {
  await prisma.devSettings.upsert({
    where: { guildId },
    create: { guildId, failureRoleId: roleId },
    update: { failureRoleId: roleId },
  });
}

/** A role that isn't mentionable only pings if the bot has Mention Everyone. */
export function mentionProblem(role: { name: string; mentionable: boolean }, botCanMentionEveryone: boolean): string | null {
  if (role.mentionable || botCanMentionEveryone) return null;
  return `I can't ping @${role.name}. Turn on "Allow anyone to @mention this role" in its settings, or give me Mention Everyone.`;
}
