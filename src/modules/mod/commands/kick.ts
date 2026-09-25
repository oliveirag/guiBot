import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { punish } from '../lib/act.js';
import { moderatorOf, resolveTarget, resultText } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick someone from the server.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.KickMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { user, member } = await resolveTarget(interaction);
    await interaction.deferReply();
    const result = await punish({
      guild: interaction.guild,
      target: user,
      member,
      moderator: moderatorOf(interaction),
      action: 'kick',
      reason: interaction.options.getString('reason'),
    });
    await interaction.editReply({ embeds: [ok(resultText(result, user))] });
  },
});
