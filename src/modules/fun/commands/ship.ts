import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { scoreBar, shipLine, stableScore } from '../lib/random.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('How compatible are two people?')
    .addUserOption((o) => o.setName('first').setDescription('Someone').setRequired(true))
    .addUserOption((o) => o.setName('second').setDescription('Someone else (default: you)')),
  cooldownSeconds: 3,
  async run({ interaction }) {
    const a = interaction.options.getUser('first', true);
    const b = interaction.options.getUser('second') ?? interaction.user;
    const score = a.id === b.id ? 100 : stableScore('ship', a.id, b.id);
    const line = a.id === b.id ? 'Self-love. Respect.' : shipLine(score);
    await interaction.reply({
      embeds: [info(`💘 ${a} × ${b}\n\`${scoreBar(score)}\` **${score}%**\n${line}`)],
      allowedMentions: { parse: [] },
    });
  },
});
