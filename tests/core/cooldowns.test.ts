import { describe, expect, it } from 'vitest';
import { Cooldowns } from '../../src/core/cooldowns.js';

describe('Cooldowns', () => {
  it('allows the first hit and blocks until the window passes', () => {
    let now = 0;
    const cooldowns = new Cooldowns(() => now);
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
    now = 1_200;
    expect(cooldowns.hit('ping:u1', 5)).toBe(4);
    now = 5_000;
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
  });

  it('tracks keys independently', () => {
    const cooldowns = new Cooldowns(() => 0);
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
    expect(cooldowns.hit('ping:u2', 5)).toBe(0);
  });
});
