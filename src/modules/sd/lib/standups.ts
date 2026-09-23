import { Prisma, type SdMember, type SdSettings, type SdStandup, type SdStandupEntry } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type EmbedBuilder,
} from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { editIn, sendTo } from './post.js';
import { JOBS, scheduleOnce } from './schedule.js';
import { getSettings, updateSettings } from './settings.js';
import { listMembers } from './team.js';
import { csvDays, dayKey, formatClock, nextOccurrence, parseClock, stamp, type Clock } from './time.js';

export const BUTTON_PREFIX = 'sd:standup:';
export const MODAL_PREFIX = 'sd:standup-modal:';
const HOUR_MS = 3_600_000;
const EMBED_BUDGET = 3800;

export interface StandupConfig {
  channelId: string;
  clock: Clock;
  days: number[];
  windowHours: number;
}

export interface OpenPayload {
  version: number;
}

export interface ClosePayload {
  standupId: number;
}

export interface EntryFields {
  yesterday: string;
  today: string;
  blockers: string | null;
}

/** Queues the next standup for these settings. Null when standups are off. */
export async function scheduleNextOpen(
  settings: SdSettings,
  after: Date,
  db: Prisma.TransactionClient = prisma,
): Promise<Date | null> {
  if (!settings.standupChannelId) return null;
  const at = nextOccurrence(after, csvDays(settings.standupDays), parseClock(settings.standupTime), settings.timezone);
  if (!at) return null;
  const payload: OpenPayload = { version: settings.standupVersion };
  await scheduleOnce(JOBS.standupOpen, at, payload, settings.guildId, db);
  return at;
}

/** Saves the schedule and queues the next standup. Jobs from the old schedule see a new version and stop. */
export function configureStandup(guildId: string, cfg: StandupConfig, now = new Date()): Promise<Date | null> {
  if (cfg.windowHours < 1 || cfg.windowHours > 12) throw new UserError('Summary delay has to be 1 to 12 hours.');
  return prisma.$transaction(async (tx) => {
    const current = await getSettings(guildId, tx);
    const settings = await updateSettings(
      guildId,
      {
        standupChannelId: cfg.channelId,
        standupTime: formatClock(cfg.clock),
        standupDays: cfg.days.join(','),
        standupWindowHours: cfg.windowHours,
        standupVersion: current.standupVersion + 1,
      },
      tx,
    );
    return scheduleNextOpen(settings, now, tx);
  });
}

export async function disableStandup(guildId: string): Promise<void> {
  const current = await getSettings(guildId);
  await updateSettings(guildId, { standupChannelId: null, standupVersion: current.standupVersion + 1 });
}

export function standupButton(standupId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${standupId}`).setLabel('Post standup').setStyle(ButtonStyle.Primary),
  );
}

export function standupModal(standupId: number, existing?: SdStandupEntry | null): ModalBuilder {
  const input = (id: string, required: boolean, max: number, value?: string | null) => {
    const text = new TextInputBuilder()
      .setCustomId(id)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(required)
      .setMaxLength(max);
    if (value) text.setValue(value);
    return text;
  };
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${standupId}`)
    .setTitle('Standup')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('What did you get done?')
        .setTextInputComponent(input('yesterday', true, 1000, existing?.yesterday)),
      new LabelBuilder().setLabel('What are you on today?').setTextInputComponent(input('today', true, 1000, existing?.today)),
      new LabelBuilder()
        .setLabel('Anything blocking you?')
        .setDescription('Leave empty if nothing is.')
        .setTextInputComponent(input('blockers', false, 500, existing?.blockers)),
    );
}

const mentions = (ids: string[]): string => ids.map((id) => `<@${id}>`).join(' ');

export function renderOpen(standup: SdStandup, entries: Pick<SdStandupEntry, 'userId'>[]): EmbedBuilder {
  const lines = standup.closedAt
    ? ['Closed. The summary is below.']
    : [
        "Tap **Post standup** and fill in what you did, what you're on, and anything blocking you.",
        `Summary posts ${stamp(standup.closesAt, 'R')}.`,
      ];
  if (entries.length > 0) lines.push('', `**In (${entries.length})** ${mentions(entries.map((e) => e.userId))}`);
  return info(lines.join('\n'), `Standup · ${standup.day}`);
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const NO_BLOCKERS = /^(none|no|nope|n\/?a|nothing|-)\.?$/i;

export const hasBlocker = (e: Pick<SdStandupEntry, 'blockers'>): boolean =>
  Boolean(e.blockers?.trim() && !NO_BLOCKERS.test(e.blockers.trim()));

/** One or more embeds: header with who's missing and who's blocked, then everyone's answers. */
export function renderSummary(standup: SdStandup, entries: SdStandupEntry[], members: SdMember[]): EmbedBuilder[] {
  const posted = new Set(entries.map((e) => e.userId));
  const missing = members.map((m) => m.userId).filter((id) => !posted.has(id));
  const blocked = entries.filter(hasBlocker);

  const header: string[] = [
    members.length > 0 ? `**${posted.size}** of ${members.length} posted.` : `**${posted.size}** posted.`,
  ];
  if (missing.length > 0) header.push(`**Missing** ${mentions(missing)}`);
  if (blocked.length > 0) header.push(`**Blocked** ${mentions(blocked.map((e) => e.userId))}`);
  if (entries.length === 0) header.push('', 'Nobody posted this time.');

  const blocks = entries.map((e) => {
    const parts = [`<@${e.userId}>`, `**Done** ${clip(e.yesterday, 900)}`, `**Today** ${clip(e.today, 900)}`];
    if (hasBlocker(e)) parts.push(`**Blocker** ${clip(e.blockers!, 500)}`);
    return parts.join('\n');
  });

  const embeds: EmbedBuilder[] = [];
  let current = header.join('\n');
  for (const block of blocks) {
    if (current.length + block.length + 2 > EMBED_BUDGET) {
      embeds.push(info(current));
      current = block;
    } else {
      current = `${current}\n\n${block}`;
    }
  }
  embeds.push(info(current));
  embeds[0]!.setTitle(`Standup summary · ${standup.day}`);
  return embeds.slice(0, 10);
}

export function standupWithEntries(standupId: number) {
  return prisma.sdStandup.findUnique({
    where: { id: standupId },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Opens today's standup in the configured channel. Safe to call again: a standup whose message never went out
 * (a failed send) gets posted now. `posted` says whether this call put a message up.
 */
export async function openStandup(
  client: Client,
  guildId: string,
  now = new Date(),
): Promise<{ standup: SdStandup; posted: boolean }> {
  const settings = await getSettings(guildId);
  if (!settings.standupChannelId) throw new UserError('Set up standups first with `/config sd standup`.');
  const day = dayKey(now, settings.timezone);

  let standup = await prisma.sdStandup.findUnique({ where: { guildId_day: { guildId, day } } });
  if (!standup) {
    const closesAt = new Date(now.getTime() + settings.standupWindowHours * HOUR_MS);
    try {
      standup = await prisma.$transaction(async (tx) => {
        const row = await tx.sdStandup.create({ data: { guildId, channelId: settings.standupChannelId!, day, closesAt } });
        const payload: ClosePayload = { standupId: row.id };
        await scheduleJob(JOBS.standupClose, closesAt, payload, guildId, tx);
        return row;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      standup = await prisma.sdStandup.findUniqueOrThrow({ where: { guildId_day: { guildId, day } } });
    }
  }
  if (standup.messageId || standup.closedAt) return { standup, posted: false };

  const message = await sendTo(client, standup.channelId, {
    embeds: [renderOpen(standup, [])],
    components: [standupButton(standup.id)],
  });
  if (!message) return { standup, posted: false };
  standup = await prisma.sdStandup.update({ where: { id: standup.id }, data: { messageId: message.id } });
  return { standup, posted: true };
}

export async function submitEntry(
  standupId: number,
  guildId: string,
  userId: string,
  fields: EntryFields,
): Promise<SdStandup & { entries: SdStandupEntry[] }> {
  const standup = await prisma.sdStandup.findFirst({ where: { id: standupId, guildId } });
  if (!standup) throw new UserError("That standup doesn't exist anymore.");
  if (standup.closedAt) throw new UserError('That standup already closed. Catch the next one.');
  const data = {
    yesterday: fields.yesterday.trim(),
    today: fields.today.trim(),
    blockers: fields.blockers?.trim() || null,
  };
  if (!data.yesterday || !data.today) throw new UserError("Fill in both what you did and what you're on.");
  await prisma.sdStandupEntry.upsert({
    where: { standupId_userId: { standupId, userId } },
    create: { standupId, userId, ...data },
    update: data,
  });
  return (await standupWithEntries(standupId))!;
}

/** Posts the summary and retires the button. Returns false when it was already closed or couldn't post. */
export async function closeStandup(client: Client, standupId: number, now = new Date()): Promise<boolean> {
  const standup = await standupWithEntries(standupId);
  if (!standup || standup.closedAt) return false;
  const members = await listMembers(standup.guildId);
  // A transient send failure throws before closedAt is set, so the job retries.
  const sent = await sendTo(client, standup.channelId, {
    embeds: renderSummary(standup, standup.entries, members),
    allowedMentions: { parse: [] },
  });
  const closed = await prisma.sdStandup.update({ where: { id: standupId }, data: { closedAt: now } });
  if (standup.messageId) {
    await editIn(client, standup.channelId, standup.messageId, {
      embeds: [renderOpen(closed, standup.entries)],
      components: [],
      allowedMentions: { parse: [] },
    });
  }
  return sent !== null;
}
