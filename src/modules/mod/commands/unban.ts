import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { revoke } from '../lib/act.js';
import { moderatorOf } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Lift a ban.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who (paste their user ID)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.BanMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    await interaction.deferReply();
    const c = await revoke({
      guild: interaction.guild,
      userId: user.id,
      userTag: user.tag,
      member: null,
      moderator: moderatorOf(interaction),
      action: 'unban',
      reason: interaction.options.getString('reason'),
    });
    await interaction.editReply({ embeds: [ok(`Unbanned **${user.tag}**. Case #${c.number}.`)] });
  },
});
