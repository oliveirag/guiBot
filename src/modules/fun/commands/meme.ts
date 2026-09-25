import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { randomMeme } from '../lib/media.js';

export default command({
  data: new SlashCommandBuilder().setName('meme').setDescription('A random meme from Reddit.'),
  cooldownSeconds: 3,
  async run({ interaction }) {
    await interaction.deferReply();
    const meme = await randomMeme();
    const embed = info(`[${meme.title.slice(0, 200)}](${meme.postLink})`).setImage(meme.url).setFooter({ text: `r/${meme.subreddit}` });
    await interaction.editReply({ embeds: [embed] });
  },
});
