import type { GuildMember } from 'discord.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';

export const JOB_TEMPROLE = 'roles.temprole.remove';
export const MAX_AUTOROLES = 10;

export type AutoTarget = 'humans' | 'bots';

export async function autoRolesFor(guildId: string, target: AutoTarget): Promise<string[]> {
  const rows = await prisma.autoRole.findMany({ where: { guildId, target } });
  return rows.map((r) => r.roleId);
}

/** Gives a new member the guild's autoroles. Waits for membership screening, since Discord won't allow it before. */
export async function giveAutoRoles(member: GuildMember): Promise<void> {
  if (member.pending) return;
  const roles = await autoRolesFor(member.guild.id, member.user.bot ? 'bots' : 'humans');
  const missing = roles.filter((r) => !member.roles.cache.has(r));
  if (missing.length === 0) return;
  try {
    await member.roles.add(missing, 'Autorole');
  } catch (error) {
    log.warn(`roles: autoroles failed in ${member.guild.id}`, error);
  }
}
