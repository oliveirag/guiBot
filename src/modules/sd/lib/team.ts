import type { SdMember } from '@prisma/client';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';

export const MAX_MEMBERS = 25;

const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Jira Cloud accountIds: "712020:<uuid>" or a 24-char hex id.
const ACCOUNT_ID = /^(?:\d+:[0-9a-f-]{36}|[0-9a-f]{24})$/i;

/** Accepts "gui", "@gui", or a pasted profile URL. */
export function normalizeGithubLogin(raw: string): string {
  const login = raw
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  if (!GITHUB_LOGIN.test(login)) throw new UserError(`"${raw}" isn't a GitHub username.`);
  return login;
}

/** An email to look up, or an accountId pasted straight from a Jira profile URL. */
export function parseJiraIdentity(raw: string): { jiraEmail: string } | { jiraAccountId: string } {
  const text = raw.trim();
  if (EMAIL.test(text)) return { jiraEmail: text.toLowerCase() };
  const id = text.replace(/^.*\/people\//, '').replace(/[/?#].*$/, '');
  if (ACCOUNT_ID.test(id)) return { jiraAccountId: id };
  throw new UserError('Use the email you log into Jira with, or your Jira profile link.');
}

export interface LinkPatch {
  githubLogin?: string;
  jiraEmail?: string | null;
  jiraAccountId?: string | null;
}

export async function linkMember(guildId: string, userId: string, patch: LinkPatch): Promise<SdMember> {
  const where = { guildId_userId: { guildId, userId } };
  const existing = await prisma.sdMember.findUnique({ where });
  if (!existing && (await prisma.sdMember.count({ where: { guildId } })) >= MAX_MEMBERS) {
    throw new UserError(`The team already has ${MAX_MEMBERS} people linked.`);
  }
  if (patch.githubLogin) {
    const taken = await prisma.sdMember.findFirst({
      where: { guildId, githubLogin: patch.githubLogin, NOT: { userId } },
    });
    if (taken) throw new UserError(`GitHub ${patch.githubLogin} is already linked to <@${taken.userId}>.`);
  }
  return prisma.sdMember.upsert({ where, create: { guildId, userId, ...patch }, update: patch });
}

export async function unlinkMember(guildId: string, userId: string): Promise<void> {
  const { count } = await prisma.sdMember.deleteMany({ where: { guildId, userId } });
  if (count === 0) throw new UserError(`<@${userId}> isn't on the team.`);
}

export function listMembers(guildId: string): Promise<SdMember[]> {
  return prisma.sdMember.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
}

export function describeMember(m: SdMember): string {
  const github = m.githubLogin ? `GitHub \`${m.githubLogin}\`` : 'no GitHub';
  const jira = m.jiraAccountId ? 'Jira ✓' : m.jiraEmail ? `Jira ${m.jiraEmail} (not matched yet)` : 'no Jira';
  return `<@${m.userId}> · ${github} · ${jira}`;
}

export function describeTeam(members: SdMember[]): string {
  if (members.length === 0) return 'Nobody yet. Link yourself with `/team link`.';
  return members.map(describeMember).join('\n');
}

/** Jira accountId to Discord user id. */
export function byJiraAccount(members: SdMember[]): Map<string, string> {
  return new Map(members.filter((m) => m.jiraAccountId).map((m) => [m.jiraAccountId!, m.userId]));
}
