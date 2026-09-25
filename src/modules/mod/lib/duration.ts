import { UserError } from '../../../core/errors.js';

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };

/** "30s", "10m", "1h30m", "7d", "2w" into seconds. */
export function parseDuration(raw: string): number {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(text)) {
    throw new UserError(`"${raw}" isn't a duration I get. Try 10m, 2h, 7d, or 1h30m.`);
  }
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(n) * UNIT_SECONDS[unit!]!;
  if (total <= 0) throw new UserError('The duration has to be more than zero.');
  return total;
}

export function formatDuration(seconds: number): string {
  const parts: string[] = [];
  let left = seconds;
  for (const [unit, size] of [
    ['d', 86_400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const n = Math.floor(left / size);
    if (n > 0) parts.push(`${n}${unit}`);
    left -= n * size;
  }
  return parts.slice(0, 2).join(' ') || '0s';
}
