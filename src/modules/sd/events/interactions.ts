import { Events, MessageFlags, type ButtonInteraction, type Interaction, type ModalSubmitInteraction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import type { Repliable } from '../../../core/reply.js';
import { prisma } from '../../../db.js';
import { RSVP_PREFIX, RSVP_STATUSES, renderMeeting, rsvpRow, setRsvp, type RsvpStatus } from '../lib/meetings.js';
import { editIn } from '../lib/post.js';
import { BUTTON_PREFIX, MODAL_PREFIX, renderOpen, standupModal, submitEntry } from '../lib/standups.js';

/** Custom ids look like "<prefix><id>" or "<prefix><id>:<extra>". */
function idFrom(customId: string, prefix: string): number {
  const id = Number(customId.slice(prefix.length).split(':')[0]);
  if (!Number.isInteger(id) || id <= 0) throw new UserError('That button is broken. Try a fresh one.');
  return id;
}

async function openStandupModal(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const standupId = idFrom(interaction.customId, BUTTON_PREFIX);
  const standup = await prisma.sdStandup.findFirst({ where: { id: standupId, guildId: interaction.guildId } });
  if (!standup) throw new UserError("That standup doesn't exist anymore.");
  if (standup.closedAt) throw new UserError('That standup already closed. Catch the next one.');
  const existing = await prisma.sdStandupEntry.findUnique({
    where: { standupId_userId: { standupId, userId: interaction.user.id } },
  });
  await interaction.showModal(standupModal(standupId, existing));
}

async function saveStandup(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const standup = await submitEntry(idFrom(interaction.customId, MODAL_PREFIX), interaction.guildId, interaction.user.id, {
    yesterday: interaction.fields.getTextInputValue('yesterday'),
    today: interaction.fields.getTextInputValue('today'),
    blockers: interaction.fields.getTextInputValue('blockers') || null,
  });
  await interaction.reply({ embeds: [ok("Got it. You're in today's standup.")], flags: MessageFlags.Ephemeral });
  if (standup.messageId) {
    await editIn(interaction.client, standup.channelId, standup.messageId, {
      embeds: [renderOpen(standup, standup.entries)],
      allowedMentions: { parse: [] },
    });
  }
}

async function rsvp(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const status = interaction.customId.split(':')[3] as RsvpStatus;
  if (!RSVP_STATUSES.includes(status)) throw new UserError('That button is broken. Try a fresh one.');
  const meeting = await setRsvp(idFrom(interaction.customId, RSVP_PREFIX), interaction.guildId, interaction.user.id, status);
  await interaction.update({ embeds: [renderMeeting(meeting, meeting.rsvps)], components: [rsvpRow(meeting.id)] });
}

export default event({
  name: Events.InteractionCreate,
  async run(interaction: Interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith('sd:')) return;
    try {
      if (interaction.isButton() && interaction.customId.startsWith(BUTTON_PREFIX)) await openStandupModal(interaction);
      else if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) await saveStandup(interaction);
      else if (interaction.isButton() && interaction.customId.startsWith(RSVP_PREFIX)) await rsvp(interaction);
    } catch (error) {
      await reportError(interaction as unknown as Repliable, error, log);
    }
  },
});
