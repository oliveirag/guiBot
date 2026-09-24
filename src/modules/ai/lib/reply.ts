import { Cooldowns } from '../../../core/cooldowns.js';
import { log } from '../../../core/log.js';
import type { Env } from '../../../env.js';
import { buildPrompt, projectSnapshot, type ChatLine } from './context.js';
import { GeminiError, type Generate } from './gemini.js';
import { systemPrompt } from './persona.js';
import { getAiConfig } from './settings.js';

const DISCORD_LIMIT = 2000;

// Shared by /ask and mentions so one can't be used to dodge the other's cooldown.
export const aiCooldowns = new Cooldowns();

export type Gate = { allowed: true } | { allowed: false; reason: 'off' } | { allowed: false; reason: 'cooldown'; left: number };

/** `channelId` is the channel AI is toggled on: a thread's parent, or the channel itself. */
export async function checkGate(
  guildId: string,
  channelId: string,
  userId: string,
  ownerIds: readonly string[],
  cooldowns: Cooldowns = aiCooldowns,
): Promise<Gate> {
  const config = await getAiConfig(guildId);
  if (!config.channelIds.has(channelId)) return { allowed: false, reason: 'off' };
  if (ownerIds.includes(userId) || config.cooldownSeconds <= 0) return { allowed: true };
  const left = cooldowns.hit(`ai:${guildId}:${userId}`, config.cooldownSeconds);
  return left > 0 ? { allowed: false, reason: 'cooldown', left } : { allowed: true };
}

export interface AnswerInput {
  guildId: string;
  jira: Env['jira'];
  generate: Generate;
  history: readonly ChatLine[];
  asker: string;
  question: string;
}

export async function answer(input: AnswerInput): Promise<string> {
  let context: string | null = null;
  try {
    context = await projectSnapshot(input.guildId, input.jira);
  } catch (error) {
    log.warn('ai: project snapshot failed', error);
  }
  const text = await input.generate({
    system: systemPrompt(context),
    prompt: buildPrompt(input.history, input.asker, input.question),
  });
  return forDiscord(text);
}

/** Fits Discord's limit and defuses mass pings in case the model writes one anyway. */
export function forDiscord(text: string): string {
  const safe = text.replace(/@(everyone|here)/g, '@​$1').trim();
  return safe.length <= DISCORD_LIMIT ? safe : `${safe.slice(0, DISCORD_LIMIT - 1)}…`;
}

export function failureMessage(error: unknown): string {
  if (error instanceof GeminiError && error.busy) return "I'm getting rate limited right now. Try again in a minute.";
  return "My brain didn't answer that one. Try again in a bit.";
}
