import type { Suggestion } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR, SUCCESS_COLOR } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';

export const VOTE_PREFIX = 'sg:';
export const STATUSES = ['approved', 'denied', 'considered'] as const;
export type Verdict = (typeof STATUSES)[number];

const LABEL: Record<string, string> = { open: 'Open', approved: 'Approved', denied: 'Denied', considered: 'Considering' };
const COLOR: Record<string, number> = { open: BRAND_COLOR, approved: SUCCESS_COLOR, denied: ERROR_COLOR, considered: 0xf59e0b };

export interface Tally {
  up: number;
  down: number;
}

export interface Author {
  name: string;
  avatarUrl?: string;
}

export function createSuggestion(input: { guildId: string; authorId: string; content: string; channelId: string }): Promise<Suggestion> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.suggestion.findFirst({ where: { guildId: input.guildId }, orderBy: { number: 'desc' } });
    return tx.suggestion.create({ data: { ...input, number: (last?.number ?? 0) + 1 } });
  });
}

export async function getSuggestion(guildId: string, number: number): Promise<Suggestion> {
  const found = await prisma.suggestion.findUnique({ where: { guildId_number: { guildId, number } } });
  if (!found) throw new UserError(`There's no suggestion #${number}.`);
  return found;
}

export async function tally(suggestionId: number): Promise<Tally> {
  const rows = await prisma.suggestionVote.groupBy({ by: ['value'], where: { suggestionId }, _count: true });
  return {
    up: rows.find((r) => r.value === 1)?._count ?? 0,
    down: rows.find((r) => r.value === -1)?._count ?? 0,
  };
}

/** Clicking the same vote again takes it back; clicking the other one switches. */
export async function vote(suggestionId: number, userId: string, value: 1 | -1): Promise<'added' | 'removed' | 'switched'> {
  const key = { suggestionId_userId: { suggestionId, userId } };
  const existing = await prisma.suggestionVote.findUnique({ where: key });
  if (existing?.value === value) {
    await prisma.suggestionVote.delete({ where: key });
    return 'removed';
  }
  await prisma.suggestionVote.upsert({ where: key, create: { suggestionId, userId, value }, update: { value } });
  return existing ? 'switched' : 'added';
}

export async function review(s: Suggestion, verdict: Verdict, reviewerId: string, reason: string | null): Promise<Suggestion> {
  return prisma.suggestion.update({ where: { id: s.id }, data: { status: verdict, reviewerId, reason } });
}

export function renderSuggestion(s: Suggestion, votes: Tally, author: Author): Pick<MessageCreateOptions, 'embeds' | 'components'> {
  const embed = new EmbedBuilder()
    .setColor(COLOR[s.status] ?? BRAND_COLOR)
    .setAuthor({ name: author.name, iconURL: author.avatarUrl })
    .setDescription(s.content)
    .addFields(
      { name: 'Status', value: LABEL[s.status] ?? s.status, inline: true },
      { name: 'Votes', value: `👍 ${votes.up} · 👎 ${votes.down}`, inline: true },
    )
    .setFooter({ text: `Suggestion #${s.number}` })
    .setTimestamp(s.createdAt);
  if (s.reviewerId && s.status !== 'open') {
    embed.addFields({ name: `${LABEL[s.status]} by`, value: `<@${s.reviewerId}>${s.reason ? `: ${s.reason}` : ''}`.slice(0, 1024) });
  }
  // Voting closes once a call is made; "considering" keeps it open.
  const closed = s.status === 'approved' || s.status === 'denied';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${VOTE_PREFIX}${s.id}:up`).setEmoji('👍').setStyle(ButtonStyle.Secondary).setDisabled(closed),
    new ButtonBuilder().setCustomId(`${VOTE_PREFIX}${s.id}:down`).setEmoji('👎').setStyle(ButtonStyle.Secondary).setDisabled(closed),
  );
  return { embeds: [embed], components: [row] };
}
