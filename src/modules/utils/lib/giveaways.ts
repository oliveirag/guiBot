import type { Giveaway } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type MessageCreateOptions,
} from 'discord.js';
import { BRAND_COLOR } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { shuffle, type Rng } from '../../fun/lib/random.js';
import { editIn, sendTo } from '../../sd/lib/post.js';

export const GA_PREFIX = 'ga:';
export const JOB_GIVEAWAY_END = 'utils.giveaway.end';
export const MAX_WINNERS = 20;
export const MIN_GIVEAWAY_SECONDS = 60;
export const MAX_GIVEAWAY_SECONDS = 60 * 86_400;

const ENDED_COLOR = 0x64748b;
const unix = (d: Date): number => Math.floor(d.getTime() / 1000);
const mentions = (ids: string[]): string => ids.map((id) => `<@${id}>`).join(', ');

export const winnersOf = (g: Pick<Giveaway, 'winnerIds'>): string[] => g.winnerIds.split(',').filter(Boolean);

export async function createGiveaway(input: {
  guildId: string;
  channelId: string;
  hostId: string;
  prize: string;
  winnerCount: number;
  seconds: number;
  now?: Date;
}): Promise<Giveaway> {
  if (input.seconds < MIN_GIVEAWAY_SECONDS) throw new UserError('Giveaways run at least a minute.');
  if (input.seconds > MAX_GIVEAWAY_SECONDS) throw new UserError('Giveaways max out at 60 days.');
  const endsAt = new Date((input.now ?? new Date()).getTime() + input.seconds * 1000);
  const { seconds: _, now: __, ...data } = input;
  return prisma.$transaction(async (tx) => {
    const last = await tx.giveaway.findFirst({ where: { guildId: input.guildId }, orderBy: { number: 'desc' } });
    const g = await tx.giveaway.create({ data: { ...data, endsAt, number: (last?.number ?? 0) + 1 } });
    await scheduleJob(JOB_GIVEAWAY_END, endsAt, { giveawayId: g.id }, input.guildId, tx);
    return g;
  });
}

export async function getGiveaway(guildId: string, number: number): Promise<Giveaway> {
  const found = await prisma.giveaway.findUnique({ where: { guildId_number: { guildId, number } } });
  if (!found) throw new UserError(`There's no giveaway #${number}.`);
  return found;
}

export function activeGiveaways(guildId: string): Promise<Giveaway[]> {
  return prisma.giveaway.findMany({ where: { guildId, ended: false }, orderBy: { endsAt: 'asc' } });
}

export const entryCount = (giveawayId: number): Promise<number> => prisma.giveawayEntry.count({ where: { giveawayId } });

/** Clicking again takes you back out. */
export async function toggleEntry(giveawayId: number, userId: string): Promise<'entered' | 'left'> {
  const key = { giveawayId_userId: { giveawayId, userId } };
  const existing = await prisma.giveawayEntry.findUnique({ where: key });
  if (existing) {
    await prisma.giveawayEntry.delete({ where: key });
    return 'left';
  }
  await prisma.giveawayEntry.create({ data: { giveawayId, userId } });
  return 'entered';
}

/** Random entrants, skipping anyone `eligible` rejects (like people who left the server). */
export async function drawWinners(
  entrants: readonly string[],
  count: number,
  eligible: (userId: string) => Promise<boolean>,
  rng: Rng = Math.random,
): Promise<string[]> {
  const winners: string[] = [];
  for (const id of shuffle(entrants, rng)) {
    if (winners.length >= count) break;
    if (await eligible(id)) winners.push(id);
  }
  return winners;
}

export function renderGiveaway(g: Giveaway, entries: number): Pick<MessageCreateOptions, 'embeds' | 'components'> {
  const winners = winnersOf(g);
  const lines = g.ended
    ? [
        `**Ended** <t:${unix(g.endsAt)}:R>`,
        `**Winners** ${winners.length > 0 ? mentions(winners) : 'nobody entered'}`,
        `**Hosted by** <@${g.hostId}>`,
      ]
    : [
        'Hit 🎉 to enter. Hit it again to back out.',
        `**Ends** <t:${unix(g.endsAt)}:R> (<t:${unix(g.endsAt)}:f>)`,
        `**Winners** ${g.winnerCount}`,
        `**Hosted by** <@${g.hostId}>`,
      ];
  const embed = new EmbedBuilder()
    .setColor(g.ended ? ENDED_COLOR : BRAND_COLOR)
    .setTitle(g.prize)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Giveaway #${g.number}` })
    .setTimestamp(g.endsAt);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GA_PREFIX}${g.id}`)
      .setEmoji('🎉')
      .setLabel(String(entries))
      .setStyle(g.ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(g.ended),
  );
  return { embeds: [embed], components: [row] };
}

/** Anyone still in the server can win. */
function memberCheck(client: Client, guildId: string): (userId: string) => Promise<boolean> {
  return async (userId) => {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    return Boolean(await guild?.members.fetch(userId).catch(() => null));
  };
}

export function announcement(prize: string, winners: string[], reroll: boolean): string {
  if (winners.length === 0) return reroll ? `Nobody else can win **${prize}**.` : `Nobody entered **${prize}**, so no winner.`;
  if (reroll) return `🎉 New pick: ${mentions(winners)}! You won **${prize}**.`;
  return `🎉 Congrats ${mentions(winners)}! You won **${prize}**.`;
}

async function announce(client: Client, g: Giveaway, winners: string[], reroll: boolean): Promise<void> {
  await sendTo(client, g.channelId, {
    content: announcement(g.prize, winners, reroll),
    allowedMentions: { users: winners },
    ...(g.messageId ? { reply: { messageReference: g.messageId, failIfNotExists: false } } : {}),
  });
}

/**
 * Ends a giveaway: draws winners, redraws the post, and announces. Null when it already ended
 * (the job and `/giveaway end` can race; whoever flips `ended` first does the work).
 */
export async function finishGiveaway(
  client: Client,
  giveawayId: number,
  rng: Rng = Math.random,
  now = new Date(),
): Promise<string[] | null> {
  const g = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
  if (!g || g.ended) return null;
  const winners = await drawWinners(
    g.entries.map((e) => e.userId),
    g.winnerCount,
    memberCheck(client, g.guildId),
    rng,
  );
  // Ending early moves endsAt up so the post shows when it actually ended.
  const endsAt = now < g.endsAt ? now : g.endsAt;
  const claimed = await prisma.giveaway.updateMany({
    where: { id: g.id, ended: false },
    data: { ended: true, winnerIds: winners.join(','), endsAt },
  });
  if (claimed.count === 0) return null;
  const done = { ...g, ended: true, winnerIds: winners.join(','), endsAt };
  if (done.messageId) await editIn(client, done.channelId, done.messageId, renderGiveaway(done, g.entries.length));
  await announce(client, done, winners, false);
  return winners;
}

/** Draws `count` more winners from entrants who haven't won this one yet. */
export async function rerollGiveaway(client: Client, g: Giveaway, count: number, rng: Rng = Math.random): Promise<string[]> {
  if (!g.ended) throw new UserError(`Giveaway #${g.number} is still running. End it first with \`/giveaway end\`.`);
  const already = new Set(winnersOf(g));
  const entrants = (await prisma.giveawayEntry.findMany({ where: { giveawayId: g.id } })).map((e) => e.userId);
  const winners = await drawWinners(
    entrants.filter((id) => !already.has(id)),
    count,
    memberCheck(client, g.guildId),
    rng,
  );
  const updated = await prisma.giveaway.update({
    where: { id: g.id },
    data: { winnerIds: [...already, ...winners].join(',') },
  });
  if (updated.messageId) await editIn(client, updated.channelId, updated.messageId, renderGiveaway(updated, entrants.length));
  await announce(client, updated, winners, true);
  return winners;
}
