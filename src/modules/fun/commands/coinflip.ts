import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  cooldownSeconds: 2,
  async run({ interaction }) {
    await interaction.reply({ embeds: [info(`🪙 **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**`)] });
  },
});
