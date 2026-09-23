import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../../../src/core/define.js';

export default command({
  data: new SlashCommandBuilder().setName('two').setDescription('Second'),
  async run() {},
});
