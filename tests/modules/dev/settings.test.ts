import { beforeEach, describe, expect, it } from 'vitest';
import { getFailureRole, mentionProblem, setFailureRole } from '../../../src/modules/dev/lib/settings.js';
import { resetDb } from '../../db.js';

describe('failure role', () => {
  beforeEach(resetDb);

  it('is unset by default, can be set, changed, and cleared per guild', async () => {
    expect(await getFailureRole('g1')).toBeNull();
    await setFailureRole('g1', 'r1');
    await setFailureRole('g2', 'r9');
    expect(await getFailureRole('g1')).toBe('r1');
    await setFailureRole('g1', 'r2');
    expect(await getFailureRole('g1')).toBe('r2');
    await setFailureRole('g1', null);
    expect(await getFailureRole('g1')).toBeNull();
    expect(await getFailureRole('g2')).toBe('r9');
  });
});

describe('mentionProblem', () => {
  it('flags a role the bot cannot actually ping', () => {
    expect(mentionProblem({ name: 'Devs', mentionable: false }, false)).toMatch(/@Devs.*@mention this role/);
  });

  it('is fine when the role is mentionable or the bot can mention everyone', () => {
    expect(mentionProblem({ name: 'Devs', mentionable: true }, false)).toBeNull();
    expect(mentionProblem({ name: 'Devs', mentionable: false }, true)).toBeNull();
  });
});
