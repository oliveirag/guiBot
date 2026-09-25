import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { EIGHT_BALL, pick } from '../lib/random.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes or no question.')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(300)),
  cooldownSeconds: 3,
  async run({ interaction }) {
    const question = interaction.options.getString('question', true);
    await interaction.reply({ embeds: [info(`> ${question}\n🎱 ${pick(EIGHT_BALL)}`)], allowedMentions: { parse: [] } });
  },
});
