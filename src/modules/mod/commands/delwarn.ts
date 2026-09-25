import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { deleteWarn } from '../lib/cases.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('delwarn')
    .setDescription("Remove a warn. It stays in the modlog but stops counting.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) => o.setName('case').setDescription('The warn case number').setRequired(true).setMinValue(1)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const c = await deleteWarn(interaction.guildId, interaction.options.getInteger('case', true));
    await interaction.reply({ embeds: [ok(`Removed warn #${c.number} from <@${c.userId}>.`)], allowedMentions: { parse: [] } });
  },
});
