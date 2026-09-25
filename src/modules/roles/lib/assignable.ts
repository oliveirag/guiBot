import type { ChatInputCommandInteraction, Role } from 'discord.js';
import { UserError } from '../../../core/errors.js';

export interface RoleFacts {
  id: string;
  position: number;
  managed: boolean;
}

/** Why guiBot (on behalf of `actorTop`) can't hand out this role, or null. Pass null for the actor to skip their check. */
export function roleProblem(role: RoleFacts, guildId: string, botTop: number, actorTop: number | null): string | null {
  if (role.id === guildId) return "That's @everyone.";
  if (role.managed) return "That role belongs to a bot or integration, so it can't be handed out.";
  if (role.position >= botTop) return 'That role is at or above mine. Move my role higher first.';
  if (actorTop !== null && role.position >= actorTop) return 'That role is at or above your top role.';
  return null;
}

/** Throws unless guiBot can give this role and the person asking outranks it (the owner always does). */
export async function assertAssignable(interaction: ChatInputCommandInteraction<'cached'>, role: Role): Promise<void> {
  const guild = interaction.guild;
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const actorTop = interaction.user.id === guild.ownerId ? null : interaction.member.roles.highest.position;
  const problem = roleProblem(role, guild.id, me.roles.highest.position, actorTop);
  if (problem) throw new UserError(problem);
}

/** Custom emoji become their id; unicode stays as is. `display` is what goes in messages. */
export function parseEmoji(raw: string): { key: string; display: string } {
  const text = raw.trim();
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(text);
  if (custom) return { key: custom[3]!, display: text };
  if (!text || /\s/.test(text) || text.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(text)) {
    throw new UserError(`"${raw}" isn't an emoji I can use.`);
  }
  return { key: text, display: text };
}

/** The key reactions are stored under: custom emoji id, or the unicode emoji. */
export const reactionKey = (emoji: { id: string | null; name: string | null }): string => emoji.id ?? emoji.name ?? '';
