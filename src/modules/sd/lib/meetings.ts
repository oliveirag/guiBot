import type { Prisma, SdMeeting, SdRsvp } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Client,
  type EmbedBuilder,
} from 'discord.js';
import { err, info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { editIn, sendTo } from './post.js';
import { JOBS } from './schedule.js';
import { sameTimeNextWeek, stamp } from './time.js';

export const RSVP_PREFIX = 'sd:rsvp:';
export const REMINDER_MINUTES = [60, 10];
const MINUTE_MS = 60_000;

export type RsvpStatus = 'yes' | 'maybe' | 'no';
export const RSVP_STATUSES: readonly RsvpStatus[] = ['yes', 'maybe', 'no'];

export type MeetingWithRsvps = SdMeeting & { rsvps: SdRsvp[] };

export interface MeetingInput {
  guildId: string;
  channelId: string;
  title: string;
  location: string | null;
  startsAt: Date;
  durationMin: number;
  weekly: boolean;
  createdBy: string;
}

export interface RemindPayload {
  meetingId: number;
  minutes: number;
  /** ISO start the reminder was scheduled for. */
  startsAt: string;
}

export interface NextPayload {
  meetingId: number;
}

async function scheduleMeetingJobs(meeting: SdMeeting, now: Date, db: Prisma.TransactionClient): Promise<void> {
  for (const minutes of REMINDER_MINUTES) {
    const at = new Date(meeting.startsAt.getTime() - minutes * MINUTE_MS);
    if (at.getTime() <= now.getTime()) continue;
    const payload: RemindPayload = { meetingId: meeting.id, minutes, startsAt: meeting.startsAt.toISOString() };
    await scheduleJob(JOBS.meetingRemind, at, payload, meeting.guildId, db);
  }
  if (meeting.weekly) {
    const payload: NextPayload = { meetingId: meeting.id };
    await scheduleJob(JOBS.meetingNext, meeting.startsAt, payload, meeting.guildId, db);
  }
}

export async function createMeeting(input: MeetingInput, now = new Date()): Promise<SdMeeting> {
  const title = input.title.trim().slice(0, 100);
  if (!title) throw new UserError('Give the meeting a name.');
  if (input.startsAt.getTime() <= now.getTime()) throw new UserError("That time's already passed.");
  if (input.durationMin < 5 || input.durationMin > 600) throw new UserError('Length has to be 5 to 600 minutes.');
  return prisma.$transaction(async (tx) => {
    const meeting = await tx.sdMeeting.create({
      data: { ...input, title, location: input.location?.trim().slice(0, 100) || null },
    });
    await scheduleMeetingJobs(meeting, now, tx);
    return meeting;
  });
}

const who = (rsvps: SdRsvp[], status: RsvpStatus): string => {
  const ids = rsvps.filter((r) => r.status === status).map((r) => `<@${r.userId}>`);
  return ids.length > 0 ? ids.join(' ').slice(0, 1024) : '-';
};

export function renderMeeting(meeting: SdMeeting, rsvps: SdRsvp[]): EmbedBuilder {
  if (meeting.cancelledAt) {
    return err(`~~${stamp(meeting.startsAt, 'F')}~~ Cancelled.`, meeting.title);
  }
  const lines = [`${stamp(meeting.startsAt, 'F')} (${stamp(meeting.startsAt, 'R')})`];
  const facts = [`**Length** ${meeting.durationMin} min`];
  if (meeting.location) facts.push(`**Where** ${meeting.location}`);
  lines.push(facts.join(' · '));
  if (meeting.weekly) lines.push('Repeats weekly');
  const count = (s: RsvpStatus) => rsvps.filter((r) => r.status === s).length;
  return info(lines.join('\n'), meeting.title)
    .addFields(
      { name: `Going (${count('yes')})`, value: who(rsvps, 'yes'), inline: true },
      { name: `Maybe (${count('maybe')})`, value: who(rsvps, 'maybe'), inline: true },
      { name: `Can't (${count('no')})`, value: who(rsvps, 'no'), inline: true },
    )
    .setFooter({ text: `Meeting #${meeting.id}` });
}

export function rsvpRow(meetingId: number): ActionRowBuilder<ButtonBuilder> {
  const button = (status: RsvpStatus, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`${RSVP_PREFIX}${meetingId}:${status}`).setLabel(label).setStyle(style);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('yes', 'Going', ButtonStyle.Success),
    button('maybe', 'Maybe', ButtonStyle.Secondary),
    button('no', "Can't make it", ButtonStyle.Danger),
  );
}

export function meetingWithRsvps(id: number): Promise<MeetingWithRsvps | null> {
  return prisma.sdMeeting.findUnique({ where: { id }, include: { rsvps: { orderBy: { updatedAt: 'asc' } } } });
}

async function createScheduledEvent(client: Client, meeting: SdMeeting): Promise<string | null> {
  try {
    const guild = await client.guilds.fetch(meeting.guildId);
    const event = await guild.scheduledEvents.create({
      name: meeting.title,
      scheduledStartTime: meeting.startsAt,
      scheduledEndTime: new Date(meeting.startsAt.getTime() + meeting.durationMin * MINUTE_MS),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: meeting.location ?? 'Discord' },
    });
    return event.id;
  } catch (error) {
    // Usually a missing Manage Events permission. The RSVP post still works without it.
    log.warn(`sd: couldn't create a Discord event for meeting ${meeting.id}`, error);
    return null;
  }
}

/** Posts the RSVP message and creates the Discord event. Returns the updated meeting, or null if it couldn't post. */
export async function publishMeeting(client: Client, meeting: SdMeeting): Promise<SdMeeting | null> {
  const message = await sendTo(client, meeting.channelId, {
    embeds: [renderMeeting(meeting, [])],
    components: [rsvpRow(meeting.id)],
  });
  if (!message) return null;
  const eventId = meeting.eventId ?? (await createScheduledEvent(client, meeting));
  return prisma.sdMeeting.update({ where: { id: meeting.id }, data: { messageId: message.id, eventId } });
}

export async function setRsvp(
  meetingId: number,
  guildId: string,
  userId: string,
  status: RsvpStatus,
  now = new Date(),
): Promise<MeetingWithRsvps> {
  const meeting = await prisma.sdMeeting.findFirst({ where: { id: meetingId, guildId } });
  if (!meeting) throw new UserError("That meeting doesn't exist anymore.");
  if (meeting.cancelledAt) throw new UserError('That meeting was cancelled.');
  if (meeting.startsAt.getTime() + meeting.durationMin * MINUTE_MS <= now.getTime()) {
    throw new UserError('That meeting already happened.');
  }
  await prisma.sdRsvp.upsert({
    where: { meetingId_userId: { meetingId, userId } },
    create: { meetingId, userId, status },
    update: { status },
  });
  return (await meetingWithRsvps(meetingId))!;
}

export function listUpcoming(guildId: string, now = new Date()): Promise<SdMeeting[]> {
  return prisma.sdMeeting.findMany({
    where: { guildId, cancelledAt: null, startsAt: { gte: now } },
    orderBy: { startsAt: 'asc' },
    take: 15,
  });
}

/** Cancels one meeting (which also ends a weekly series). Only its creator or a server manager can. */
export async function cancelMeeting(
  client: Client,
  guildId: string,
  id: number,
  userId: string,
  canManage: boolean,
  now = new Date(),
): Promise<SdMeeting> {
  const meeting = await prisma.sdMeeting.findFirst({ where: { id, guildId } });
  if (!meeting) throw new UserError(`No meeting #${id}. See \`/meeting list\`.`);
  if (meeting.cancelledAt) throw new UserError(`#${id} is already cancelled.`);
  if (meeting.createdBy !== userId && !canManage) {
    throw new UserError('Only whoever set it up (or a server manager) can cancel it.');
  }
  const cancelled = await prisma.sdMeeting.update({ where: { id }, data: { cancelledAt: now } });
  if (meeting.messageId) {
    await editIn(client, meeting.channelId, meeting.messageId, { embeds: [renderMeeting(cancelled, [])], components: [] });
  }
  if (meeting.eventId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.scheduledEvents.delete(meeting.eventId);
    } catch (error) {
      log.warn(`sd: couldn't delete Discord event ${meeting.eventId}`, error);
    }
  }
  return cancelled;
}

/** Pings everyone who said going or maybe. Skips cancelled or moved meetings. */
export async function remindMeeting(client: Client, payload: RemindPayload): Promise<boolean> {
  const meeting = await meetingWithRsvps(payload.meetingId);
  if (!meeting || meeting.cancelledAt || meeting.startsAt.toISOString() !== payload.startsAt) return false;
  const users = meeting.rsvps.filter((r) => r.status !== 'no').map((r) => r.userId);
  const where = meeting.location ? `\n**Where** ${meeting.location}` : '';
  const sent = await sendTo(client, meeting.channelId, {
    content: users.length > 0 ? users.map((id) => `<@${id}>`).join(' ') : undefined,
    embeds: [info(`**${meeting.title}** starts ${stamp(meeting.startsAt, 'R')}.${where}`, 'Meeting soon')],
    allowedMentions: { users },
  });
  return sent !== null;
}

/**
 * Creates and posts next week's copy of a weekly meeting. Idempotent: a copy that already exists is
 * only posted if its message never went out.
 */
export async function rollWeekly(
  client: Client,
  meetingId: number,
  timeZone: string,
  now = new Date(),
): Promise<SdMeeting | null> {
  const meeting = await prisma.sdMeeting.findUnique({ where: { id: meetingId } });
  if (!meeting?.weekly || meeting.cancelledAt) return null;
  const startsAt = sameTimeNextWeek(meeting.startsAt, timeZone);
  let next = await prisma.sdMeeting.findFirst({
    where: { guildId: meeting.guildId, title: meeting.title, startsAt, cancelledAt: null },
  });
  if (!next) {
    next = await createMeeting(
      {
        guildId: meeting.guildId,
        channelId: meeting.channelId,
        title: meeting.title,
        location: meeting.location,
        startsAt,
        durationMin: meeting.durationMin,
        weekly: true,
        createdBy: meeting.createdBy,
      },
      now,
    );
  }
  if (next.messageId) return next;
  return (await publishMeeting(client, next)) ?? next;
}
