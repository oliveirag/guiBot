export interface Ranked {
  id: string;
  /** Position of their highest role. */
  top: number;
}

export interface HierarchyInput {
  actor: Ranked;
  target: Ranked;
  bot: Ranked;
  ownerId: string;
}

/** Why this person can't be moderated by this actor, or null if it's fine. */
export function hierarchyProblem({ actor, target, bot, ownerId }: HierarchyInput): string | null {
  if (target.id === actor.id) return "You can't do that to yourself.";
  if (target.id === bot.id) return 'Nice try.';
  if (target.id === ownerId) return "That's the server owner.";
  if (actor.id !== ownerId && target.top >= actor.top) return 'Their top role is at or above yours.';
  if (target.top >= bot.top) return "Their top role is at or above mine, so I can't. Move my role higher.";
  return null;
}

// Discord caps timeouts at 28 days.
export const MAX_TIMEOUT_SECONDS = 28 * 86_400;
