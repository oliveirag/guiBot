import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import {
  byJiraAccount,
  describeTeam,
  linkMember,
  listMembers,
  normalizeGithubLogin,
  parseJiraIdentity,
  unlinkMember,
} from '../../../src/modules/sd/lib/team.js';
import { resetDb } from '../../db.js';

describe('normalizeGithubLogin', () => {
  it('accepts usernames however they get pasted', () => {
    for (const raw of [
      'OliveiraG',
      '@oliveirag',
      'https://github.com/oliveirag',
      'github.com/oliveirag/guiBot',
      '<https://github.com/oliveirag>',
    ]) {
      expect(normalizeGithubLogin(raw), raw).toBe('oliveirag');
    }
  });

  it('rejects things that cannot be usernames', () => {
    expect(() => normalizeGithubLogin('not a user')).toThrow(UserError);
    expect(() => normalizeGithubLogin('-leading')).toThrow(UserError);
  });
});

describe('parseJiraIdentity', () => {
  it('takes an email', () => {
    expect(parseJiraIdentity(' Gui@UCF.edu ')).toEqual({ jiraEmail: 'gui@ucf.edu' });
  });

  it('takes an accountId or a profile link', () => {
    const id = '712020:0b3c5b2a-1111-4c4c-8d8d-123456789abc';
    expect(parseJiraIdentity(id)).toEqual({ jiraAccountId: id });
    expect(parseJiraIdentity(`https://sd.atlassian.net/jira/people/${id}`)).toEqual({ jiraAccountId: id });
    expect(parseJiraIdentity('5b10ac8d82e05b22cc7d4ef5')).toEqual({ jiraAccountId: '5b10ac8d82e05b22cc7d4ef5' });
  });

  it('rejects anything else', () => {
    expect(() => parseJiraIdentity('gui')).toThrow(UserError);
  });
});

describe('team storage', () => {
  beforeEach(resetDb);

  it('links, updates only what was given, and lists in join order', async () => {
    await linkMember('g1', 'u1', { githubLogin: 'gui' });
    await linkMember('g1', 'u2', { jiraAccountId: 'acc-2' });
    await linkMember('g1', 'u1', { jiraEmail: 'gui@ucf.edu', jiraAccountId: 'acc-1' });
    const members = await listMembers('g1');
    expect(members.map((m) => [m.userId, m.githubLogin, m.jiraAccountId])).toEqual([
      ['u1', 'gui', 'acc-1'],
      ['u2', null, 'acc-2'],
    ]);
    expect(byJiraAccount(members)).toEqual(
      new Map([
        ['acc-1', 'u1'],
        ['acc-2', 'u2'],
      ]),
    );
  });

  it("won't link one GitHub account to two people", async () => {
    await linkMember('g1', 'u1', { githubLogin: 'gui' });
    await expect(linkMember('g1', 'u2', { githubLogin: 'gui' })).rejects.toThrow(/already linked to <@u1>/);
    // Other servers are separate.
    await expect(linkMember('g2', 'u2', { githubLogin: 'gui' })).resolves.toBeDefined();
  });

  it('unlinks, and says so when there was nothing to unlink', async () => {
    await linkMember('g1', 'u1', { githubLogin: 'gui' });
    await unlinkMember('g1', 'u1');
    expect(await listMembers('g1')).toEqual([]);
    await expect(unlinkMember('g1', 'u1')).rejects.toThrow(UserError);
  });

  it('describes the team, including unmatched Jira emails', async () => {
    await linkMember('g1', 'u1', { githubLogin: 'gui', jiraEmail: 'gui@ucf.edu' });
    const text = describeTeam(await listMembers('g1'));
    expect(text).toContain('<@u1>');
    expect(text).toContain('`gui`');
    expect(text).toContain('not matched yet');
    expect(describeTeam([])).toMatch(/team link/);
  });
});
