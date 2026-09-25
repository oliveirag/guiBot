import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { punish } from '../lib/act.js';
import { moderatorOf, resolveTarget, resultText } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn someone. Warns can escalate (see /config mod escalate).')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(400)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { user, member } = await resolveTarget(interaction);
    await interaction.deferReply();
    const result = await punish({
      guild: interaction.guild,
      target: user,
      member,
      moderator: moderatorOf(interaction),
      action: 'warn',
      reason: interaction.options.getString('reason', true),
    });
    await interaction.editReply({ embeds: [ok(resultText(result, user))] });
  },
});
