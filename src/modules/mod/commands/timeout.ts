import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { punish } from '../lib/act.js';
import { parseDuration } from '../lib/duration.js';
import { moderatorOf, resolveTarget, resultText } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription("Time someone out so they can't talk for a while.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Like 10m, 1h, 1d (max 28d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const duration = parseDuration(interaction.options.getString('duration', true));
    const { user, member } = await resolveTarget(interaction);
    await interaction.deferReply();
    const result = await punish({
      guild: interaction.guild,
      target: user,
      member,
      moderator: moderatorOf(interaction),
      action: 'timeout',
      reason: interaction.options.getString('reason'),
      duration,
    });
    await interaction.editReply({ embeds: [ok(resultText(result, user))] });
  },
});
