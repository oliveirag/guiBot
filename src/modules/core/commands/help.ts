import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { getDisabledModules } from '../../../core/guildConfig.js';
import { buildHelp } from '../lib/help.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List commands, or get details on one.')
    .addStringOption((o) => o.setName('command').setDescription('Command name, like ping')),
  async run({ interaction, registry }) {
    const disabled = interaction.inGuild() ? await getDisabledModules(interaction.guildId) : new Set<string>();
    const embed = buildHelp(registry, disabled, interaction.options.getString('command'));
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
