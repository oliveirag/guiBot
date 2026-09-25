import type { ChatInputCommandInteraction, GuildMember, User } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { ACTION_LABEL, type CaseAction } from './cases.js';
import type { PunishResult } from './act.js';
import { hierarchyProblem } from './checks.js';

export interface Target {
  user: User;
  member: GuildMember | null;
}

/** The user from `option`, their membership if any, and a hierarchy check against the mod and the bot. */
export async function resolveTarget(interaction: ChatInputCommandInteraction<'cached'>, option = 'user'): Promise<Target> {
  const user = interaction.options.getUser(option, true);
  const guild = interaction.guild;
  const member = interaction.options.getMember(option) ?? (await guild.members.fetch(user.id).catch(() => null));
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const problem = hierarchyProblem({
    actor: { id: interaction.user.id, top: interaction.member.roles.highest.position },
    // Someone who isn't in the server has no roles to outrank.
    target: { id: user.id, top: member?.roles.highest.position ?? -1 },
    bot: { id: me.id, top: me.roles.highest.position },
    ownerId: guild.ownerId,
  });
  if (problem) throw new UserError(problem);
  return { user, member };
}

export const moderatorOf = (interaction: ChatInputCommandInteraction): { id: string; name: string } => ({
  id: interaction.user.id,
  name: interaction.user.username,
});

export function resultText(result: PunishResult, user: User): string {
  const c = result.case;
  const parts = [`${ACTION_LABEL[c.action as CaseAction]}: **${user.tag}**. Case #${c.number}.`];
  if (result.dmed === false) parts.push("Couldn't DM them.");
  if (result.escalated) {
    parts.push(`That hit the warn limit, so: ${ACTION_LABEL[result.escalated.action as CaseAction]} (case #${result.escalated.number}).`);
  }
  return parts.join(' ');
}
