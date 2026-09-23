import { err } from './embeds.js';
import type { Logger } from './log.js';
import { respond, type Repliable } from './reply.js';

/** An error whose message is safe and meant to be shown to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export const GENERIC_ERROR = "Something broke on my end. It's been logged.";

export async function reportError(interaction: Repliable, error: unknown, log: Logger): Promise<void> {
  const isUserError = error instanceof UserError;
  if (!isUserError) log.error('command failed', error);
  try {
    await respond(interaction, err(isUserError ? error.message : GENERIC_ERROR));
  } catch (replyError) {
    log.error('failed to report error to user', replyError);
  }
}
