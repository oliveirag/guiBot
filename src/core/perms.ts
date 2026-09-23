import type { PermissionResolvable } from 'discord.js';
import type { AccessRules } from './types.js';

export interface AccessInput {
  userId: string;
  ownerIds: readonly string[];
  inGuild: boolean;
  has: (permission: PermissionResolvable) => boolean;
}

/** Returns a user-facing denial message, or null if allowed. */
export function checkAccess(rules: AccessRules, input: AccessInput): string | null {
  if (rules.ownerOnly && !input.ownerIds.includes(input.userId)) return 'Only the bot owner can use this.';
  if (rules.guildOnly && !input.inGuild) return 'This only works in a server.';
  if (rules.memberPermissions && !input.has(rules.memberPermissions)) return "You don't have permission to use this.";
  return null;
}
