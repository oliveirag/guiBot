import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { stableScore } from '../lib/random.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('guiBot rates anything out of 10.')
    .addStringOption((o) => o.setName('thing').setDescription('What to rate').setRequired(true).setMaxLength(200)),
  cooldownSeconds: 2,
  async run({ interaction }) {
    const thing = interaction.options.getString('thing', true);
    const score = Math.round(stableScore('rate', thing) / 10);
    await interaction.reply({ embeds: [info(`I'd give **${thing}** a **${score}/10**.`)], allowedMentions: { parse: [] } });
  },
});
