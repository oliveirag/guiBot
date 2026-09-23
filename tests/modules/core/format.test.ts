import { describe, expect, it } from 'vitest';
import { formatUptime } from '../../../src/modules/core/lib/format.js';

describe('formatUptime', () => {
  it.each([
    [30, '<1m'],
    [90, '1m'],
    [3_660, '1h 1m'],
    [86_400, '1d'],
    [90_061, '1d 1h 1m'],
  ])('%i seconds -> %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });
});
