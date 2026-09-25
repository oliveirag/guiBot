import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { punish } from '../lib/act.js';
import { parseDuration } from '../lib/duration.js';
import { moderatorOf, resolveTarget, resultText } from '../lib/target.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban someone, for good or for a while.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who (works with IDs of people not in the server)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(400))
    .addStringOption((o) => o.setName('duration').setDescription('Temp ban length, like 7d. Leave empty for permanent'))
    .addIntegerOption((o) =>
      o
        .setName('delete')
        .setDescription('Delete their recent messages')
        .addChoices(
          { name: 'None', value: 0 },
          { name: 'Last hour', value: 3600 },
          { name: 'Last day', value: 86_400 },
          { name: 'Last 7 days', value: 604_800 },
        ),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.BanMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const rawDuration = interaction.options.getString('duration');
    const duration = rawDuration ? parseDuration(rawDuration) : null;
    const { user, member } = await resolveTarget(interaction);
    await interaction.deferReply();
    const result = await punish({
      guild: interaction.guild,
      target: user,
      member,
      moderator: moderatorOf(interaction),
      action: 'ban',
      reason: interaction.options.getString('reason'),
      duration,
      deleteMessageSeconds: interaction.options.getInteger('delete') ?? 0,
    });
    await interaction.editReply({ embeds: [ok(resultText(result, user))] });
  },
});
