import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { revoke } from '../lib/act.js';
import { moderatorOf, resolveTarget } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('End a timeout early.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { user, member } = await resolveTarget(interaction);
    await interaction.deferReply();
    const c = await revoke({
      guild: interaction.guild,
      userId: user.id,
      userTag: user.tag,
      member,
      moderator: moderatorOf(interaction),
      action: 'untimeout',
      reason: interaction.options.getString('reason'),
    });
    await interaction.editReply({ embeds: [ok(`**${user.tag}** can talk again. Case #${c.number}.`)] });
  },
});
