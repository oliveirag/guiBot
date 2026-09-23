import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { canPost } from '../../dev/lib/feeds.js';
import { getSettings } from '../lib/settings.js';
import { closeStandup, configureStandup, disableStandup, openStandup } from '../lib/standups.js';
import { dayKey, formatDays, parseClock, parseDays, stamp } from '../lib/time.js';

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export default command({
  data: new SlashCommandBuilder()
    .setName('standup')
    .setDescription('Schedule standups, or run today\'s by hand.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('config')
        .setDescription('Post a standup on a schedule and summarize it later.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where standups go').setRequired(true).addChannelTypes(...TEXT_CHANNELS),
        )
        .addStringOption((o) => o.setName('time').setDescription('Like 10am or 09:30').setRequired(true))
        .addStringOption((o) => o.setName('days').setDescription('Like mon-fri or mon,wed,fri (default mon-fri)'))
        .addIntegerOption((o) =>
          o
            .setName('summary-after')
            .setDescription('Hours until the summary posts (default 4)')
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Stop scheduled standups.'))
    .addSubcommand((s) => s.setName('open').setDescription("Post today's standup now."))
    .addSubcommand((s) => s.setName('close').setDescription("Post today's summary now.")),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      const channel = interaction.options.getChannel('channel', true, [...TEXT_CHANNELS]);
      if (!canPost(channel.permissionsFor(interaction.client.user))) {
        throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
      }
      const clock = parseClock(interaction.options.getString('time', true));
      const days = parseDays(interaction.options.getString('days') ?? 'mon-fri');
      const windowHours = interaction.options.getInteger('summary-after') ?? 4;
      const at = await configureStandup(guildId, { channelId: channel.id, clock, days, windowHours });
      const next = at ? ` Next one ${stamp(at, 'f')}.` : '';
      await interaction.reply({
        embeds: [ok(`Standups post in ${channel} ${formatDays(days)}, summary ${windowHours}h later.${next}`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'off') {
      await disableStandup(guildId);
      await interaction.reply({ embeds: [ok('Scheduled standups are off.')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'open') {
      const { standup, posted } = await openStandup(interaction.client, guildId);
      if (!posted) {
        throw new UserError(
          standup.messageId ? "Today's standup is already up." : `I couldn't post in <#${standup.channelId}>.`,
        );
      }
      await interaction.reply({ embeds: [ok(`Standup is up in <#${standup.channelId}>.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const { timezone } = await getSettings(guildId);
    const standup = await prisma.sdStandup.findUnique({
      where: { guildId_day: { guildId, day: dayKey(new Date(), timezone) } },
    });
    if (!standup) throw new UserError('There is no standup today.');
    if (standup.closedAt) throw new UserError("Today's standup already closed.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await closeStandup(interaction.client, standup.id))) {
      throw new UserError(`I couldn't post the summary in <#${standup.channelId}>.`);
    }
    await interaction.editReply({ embeds: [ok('Summary posted.')] });
  },
});
