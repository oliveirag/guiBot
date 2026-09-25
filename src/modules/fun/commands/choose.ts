import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { parseChoices, pick } from '../lib/random.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Let guiBot pick for you.')
    .addStringOption((o) => o.setName('options').setDescription('Split by commas, like pizza, tacos, sushi').setRequired(true).setMaxLength(1000)),
  cooldownSeconds: 2,
  async run({ interaction }) {
    const choice = pick(parseChoices(interaction.options.getString('options', true)));
    await interaction.reply({ embeds: [info(`I pick **${choice}**.`)], allowedMentions: { parse: [] } });
  },
});
