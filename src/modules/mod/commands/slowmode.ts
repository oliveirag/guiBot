import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { formatDuration, parseDuration } from '../lib/duration.js';

// Discord's max slowmode is 6 hours.
const MAX_SLOWMODE = 21_600;

export default command({
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set how long people wait between messages in a channel.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('delay').setDescription('Like 5s, 1m, 2h, or "off"').setRequired(true))
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Default: this one').addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageChannels,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('setRateLimitPerUser' in channel)) throw new UserError("Slowmode doesn't work in that channel.");
    const raw = interaction.options.getString('delay', true).trim().toLowerCase();
    const seconds = raw === 'off' || raw === '0' ? 0 : parseDuration(raw);
    if (seconds > MAX_SLOWMODE) throw new UserError('Slowmode maxes out at 6h.');
    await channel.setRateLimitPerUser(seconds, `${interaction.user.username}: slowmode`);
    await interaction.reply({
      embeds: [ok(seconds === 0 ? `Slowmode is off in ${channel}.` : `Slowmode in ${channel}: ${formatDuration(seconds)}.`)],
    });
  },
});
