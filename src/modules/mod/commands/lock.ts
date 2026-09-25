import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { isLockable, setLocked } from '../lib/channels.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Stop @everyone from talking in a channel.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Default: this one')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(300)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageChannels,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !isLockable(channel)) throw new UserError("I can't lock that channel.");
    const reason = interaction.options.getString('reason');
    await setLocked(channel, interaction.guild.roles.everyone, true, `${interaction.user.username}: ${reason ?? 'locked'}`);
    await interaction.reply({ embeds: [ok(`🔒 ${channel} is locked.${reason ? ` ${reason}` : ''}`)] });
  },
});
