import { createHash } from 'node:crypto';
import { UserError } from '../../../core/errors.js';

export type Rng = () => number;

export const pick = <T>(items: readonly T[], rng: Rng = Math.random): T => items[Math.floor(rng() * items.length)]!;

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const EIGHT_BALL = [
  'Yes.',
  'Definitely.',
  'Without a doubt.',
  'Looks good to me.',
  'Most likely.',
  'Signs point to yes.',
  'Ask again later.',
  "Can't say right now.",
  'Better not tell you now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'No.',
  'My sources say no.',
  'Very doubtful.',
  'Not a chance.',
] as const;

/** A stable 0-100 score for the same inputs, so /ship and /rate don't change on a reroll. */
export function stableScore(...parts: string[]): number {
  const key = parts.map((p) => p.trim().toLowerCase()).sort().join('\u0000');
  return createHash('sha256').update(key).digest().readUInt32BE(0) % 101;
}

export function scoreBar(score: number, width = 10): string {
  const filled = Math.round((score / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function shipLine(score: number): string {
  if (score >= 90) return 'Soulmates. Book the venue.';
  if (score >= 70) return 'Real potential here.';
  if (score >= 50) return 'Could work with some effort.';
  if (score >= 30) return 'Friends, probably.';
  if (score >= 10) return 'Rough.';
  return 'Not in this universe.';
}

export interface Dice {
  count: number;
  sides: number;
  modifier: number;
}

const DICE = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i;

/** Parses "d20", "2d6", "3d8+2". A bare number means one die with that many sides. */
export function parseDice(text: string): Dice {
  const raw = text.trim();
  if (/^\d+$/.test(raw)) return checkDice({ count: 1, sides: Number(raw), modifier: 0 });
  const m = DICE.exec(raw);
  if (!m) throw new UserError('Use dice like `d20`, `2d6`, or `3d8+2`.');
  const modifier = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
  return checkDice({ count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]), modifier });
}

function checkDice(d: Dice): Dice {
  if (d.count < 1 || d.count > 100) throw new UserError('Roll between 1 and 100 dice.');
  if (d.sides < 2 || d.sides > 1000) throw new UserError('Dice need 2 to 1000 sides.');
  if (Math.abs(d.modifier) > 1000) throw new UserError('Keep the modifier under 1000.');
  return d;
}

export function rollDice(d: Dice, rng: Rng = Math.random): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: d.count }, () => 1 + Math.floor(rng() * d.sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + d.modifier };
}

/** Splits "a, b, c" or "a | b | c" into choices. */
export function parseChoices(text: string): string[] {
  const parts = text.split(text.includes('|') ? '|' : ',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) throw new UserError('Give me at least two options, split by commas.');
  return parts;
}

export const RPS = ['rock', 'paper', 'scissors'] as const;
export type Rps = (typeof RPS)[number];
export const RPS_EMOJI: Record<Rps, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };

export function rpsResult(you: Rps, me: Rps): 'win' | 'lose' | 'tie' {
  if (you === me) return 'tie';
  return (RPS.indexOf(you) - RPS.indexOf(me) + 3) % 3 === 1 ? 'win' : 'lose';
}
