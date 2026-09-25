import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { dogImage } from '../lib/media.js';

export default command({
  data: new SlashCommandBuilder().setName('dog').setDescription('A random dog picture.'),
  cooldownSeconds: 3,
  async run({ interaction }) {
    await interaction.deferReply();
    const url = await dogImage();
    await interaction.editReply({ embeds: [info('🐶').setImage(url)] });
  },
});
