import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('ping').setDescription('Check if guiBot is awake.'),
  cooldownSeconds: 5,
  async run({ interaction }) {
    const roundtrip = Date.now() - interaction.createdTimestamp;
    await interaction.reply({
      embeds: [info(`Pong. Gateway ${interaction.client.ws.ping}ms, roundtrip ${roundtrip}ms.`)],
    });
  },
});
