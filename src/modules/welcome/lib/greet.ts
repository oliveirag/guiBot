import type { WelcomeSettings } from '@prisma/client';
import type { MessageCreateOptions } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { prisma } from '../../../db.js';

export const DEFAULT_JOIN = 'Welcome to **{server}**, {user}! You’re member #{count}.';
export const DEFAULT_LEAVE = '**{username}** left. We’re at {count} now.';
export const TEMPLATE_HELP = 'Use {user}, {username}, {server}, {count}.';

export interface GreetVars {
  userId: string;
  username: string;
  server: string;
  count: number;
}

/** Fills {user} {username} {server} {count}. Unknown placeholders stay as typed. */
export function renderTemplate(template: string, vars: GreetVars): string {
  return template
    .replaceAll('{user}', `<@${vars.userId}>`)
    .replaceAll('{username}', vars.username)
    .replaceAll('{server}', vars.server)
    .replaceAll('{count}', String(vars.count));
}

export function greeting(template: string, vars: GreetVars, embed: boolean, avatarUrl?: string): MessageCreateOptions {
  const text = renderTemplate(template, vars).slice(0, 2000);
  // Only the person being greeted gets pinged, whatever the template says.
  const allowedMentions = { users: [vars.userId] };
  if (!embed) return { content: text, allowedMentions };
  const e = info(text);
  if (avatarUrl) e.setThumbnail(avatarUrl);
  // Mentions inside embeds don't ping, so put the ping above it.
  const ping = text.includes(`<@${vars.userId}>`) ? `<@${vars.userId}>` : undefined;
  return { content: ping, embeds: [e], allowedMentions };
}

export type WelcomePatch = Partial<Omit<WelcomeSettings, 'guildId' | 'updatedAt'>>;

export function getWelcome(guildId: string): Promise<WelcomeSettings | null> {
  return prisma.welcomeSettings.findUnique({ where: { guildId } });
}

export function updateWelcome(guildId: string, patch: WelcomePatch): Promise<WelcomeSettings> {
  return prisma.welcomeSettings.upsert({ where: { guildId }, create: { guildId, ...patch }, update: patch });
}
