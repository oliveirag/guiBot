import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { canPost } from '../../dev/lib/feeds.js';
import { cancelMeeting, createMeeting, listUpcoming, publishMeeting } from '../lib/meetings.js';
import { getSettings } from '../lib/settings.js';
import { parseClock, parseDate, stamp, zonedTime } from '../lib/time.js';

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export default command({
  data: new SlashCommandBuilder()
    .setName('meeting')
    .setDescription('Plan team meetings with RSVPs and reminders.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Schedule a meeting. Reminders go out 1 hour and 10 minutes before.')
        .addStringOption((o) => o.setName('title').setDescription('What it is').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('date').setDescription('Like 2026-10-05 or 10/5').setRequired(true))
        .addStringOption((o) => o.setName('time').setDescription('Like 7pm or 19:00').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('length').setDescription('Minutes (default 60)').setMinValue(5).setMaxValue(600),
        )
        .addBooleanOption((o) => o.setName('weekly').setDescription('Repeat every week'))
        .addStringOption((o) => o.setName('location').setDescription('Room, link, or voice channel').setMaxLength(100))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to post it (default here)').addChannelTypes(...TEXT_CHANNELS),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show upcoming meetings.'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel a meeting (and stop it repeating).')
        .addIntegerOption((o) => o.setName('id').setDescription('The #number from /meeting list').setRequired(true)),
    ),
  guildOnly: true,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const now = new Date();

    if (sub === 'list') {
      const lines = (await listUpcoming(guildId, now)).map(
        (m) =>
          `\`#${m.id}\` **${m.title}** · ${stamp(m.startsAt, 'f')} (${stamp(m.startsAt, 'R')})${m.weekly ? ' · weekly' : ''}`,
      );
      await interaction.reply({
        embeds: [info(lines.join('\n') || 'Nothing scheduled. Add one with `/meeting create`.', 'Upcoming meetings')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'cancel') {
      const meeting = await cancelMeeting(
        interaction.client,
        guildId,
        interaction.options.getInteger('id', true),
        interaction.user.id,
        interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild),
        now,
      );
      await interaction.reply({ embeds: [ok(`**${meeting.title}** on ${stamp(meeting.startsAt, 'f')} is cancelled.`)] });
      return;
    }

    const channel = interaction.options.getChannel('channel', false, [...TEXT_CHANNELS]) ?? interaction.channel;
    if (!channel || !canPost(channel.permissionsFor(interaction.client.user))) {
      throw new UserError("I can't post there. I need View Channel, Send Messages, and Embed Links.");
    }
    const { timezone } = await getSettings(guildId);
    const date = parseDate(interaction.options.getString('date', true), now, timezone);
    const clock = parseClock(interaction.options.getString('time', true));
    const meeting = await createMeeting(
      {
        guildId,
        channelId: channel.id,
        title: interaction.options.getString('title', true),
        location: interaction.options.getString('location'),
        startsAt: zonedTime(date, clock, timezone),
        durationMin: interaction.options.getInteger('length') ?? 60,
        weekly: interaction.options.getBoolean('weekly') ?? false,
        createdBy: interaction.user.id,
      },
      now,
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const published = await publishMeeting(interaction.client, meeting);
    if (!published) throw new UserError(`Saved as #${meeting.id}, but I couldn't post in ${channel}.`);
    const event = published.eventId ? '' : ' No Discord event, since I need Manage Events for that.';
    await interaction.editReply({
      embeds: [ok(`**${meeting.title}** is on for ${stamp(meeting.startsAt, 'f')} in ${channel}.${event}`)],
    });
  },
});
