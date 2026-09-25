import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { isLockable, setLocked } from '../lib/channels.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Let @everyone talk in a channel again.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Default: this one')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageChannels,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !isLockable(channel)) throw new UserError("I can't unlock that channel.");
    await setLocked(channel, interaction.guild.roles.everyone, false, `${interaction.user.username}: unlocked`);
    await interaction.reply({ embeds: [ok(`🔓 ${channel} is open again.`)] });
  },
});
