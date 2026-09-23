import { describe, expect, it } from 'vitest';
import { checkAccess, type AccessInput } from '../../src/core/perms.js';

const input = (overrides: Partial<AccessInput> = {}): AccessInput => ({
  userId: 'u1',
  ownerIds: ['owner'],
  inGuild: true,
  has: () => true,
  ...overrides,
});

describe('checkAccess', () => {
  it('allows commands with no rules', () => {
    expect(checkAccess({}, input())).toBeNull();
  });

  it('blocks non-owners from owner-only commands', () => {
    expect(checkAccess({ ownerOnly: true }, input())).toMatch(/owner/);
    expect(checkAccess({ ownerOnly: true }, input({ userId: 'owner' }))).toBeNull();
  });

  it('blocks guild-only commands in DMs', () => {
    expect(checkAccess({ guildOnly: true }, input({ inGuild: false }))).toMatch(/server/);
  });

  it('checks member permissions', () => {
    expect(checkAccess({ memberPermissions: 'ManageGuild' }, input({ has: () => false }))).toMatch(/permission/);
    expect(checkAccess({ memberPermissions: 'ManageGuild' }, input())).toBeNull();
  });
});
