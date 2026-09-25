import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { catImage } from '../lib/media.js';

export default command({
  data: new SlashCommandBuilder().setName('cat').setDescription('A random cat picture.'),
  cooldownSeconds: 3,
  async run({ interaction }) {
    await interaction.deferReply();
    const url = await catImage();
    await interaction.editReply({ embeds: [info('🐱').setImage(url)] });
  },
});
