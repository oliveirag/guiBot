import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { parseDice, rollDice } from '../lib/random.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice.')
    .addStringOption((o) => o.setName('dice').setDescription('Like d20, 2d6, or 3d8+2 (default d6)').setMaxLength(20)),
  cooldownSeconds: 2,
  async run({ interaction }) {
    const raw = interaction.options.getString('dice') ?? 'd6';
    const dice = parseDice(raw);
    const { rolls, total } = rollDice(dice);
    const shown = rolls.length > 1 || dice.modifier ? ` (${rolls.join(' + ')}${dice.modifier ? ` ${dice.modifier < 0 ? '-' : '+'} ${Math.abs(dice.modifier)}` : ''})` : '';
    await interaction.reply({ embeds: [info(`🎲 \`${raw.trim()}\` → **${total}**${shown}`.slice(0, 4096))] });
  },
});
