import type { PollData } from 'discord.js';
import { UserError } from '../../../core/errors.js';

// Discord's limits for native polls.
export const MAX_ANSWERS = 10;
export const MAX_ANSWER_LENGTH = 55;
export const MAX_POLL_HOURS = 768;

/** "Pizza | Tacos | Sushi" (or commas when there's no pipe) into answers. */
export function parseAnswers(raw: string): string[] {
  const answers = raw
    .split(raw.includes('|') ? '|' : ',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (answers.length < 2) throw new UserError('Give at least 2 answers, split with `|`. Like `Pizza | Tacos`.');
  if (answers.length > MAX_ANSWERS) throw new UserError(`Polls max out at ${MAX_ANSWERS} answers.`);
  const long = answers.find((a) => a.length > MAX_ANSWER_LENGTH);
  if (long) throw new UserError(`"${long.slice(0, 20)}…" is too long. Answers max out at ${MAX_ANSWER_LENGTH} characters.`);
  if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) throw new UserError('Two of those answers are the same.');
  return answers;
}

export function buildPoll(question: string, answers: string[], hours: number, multi: boolean): PollData {
  return {
    question: { text: question },
    answers: answers.map((text) => ({ text })),
    duration: hours,
    allowMultiselect: multi,
  };
}
