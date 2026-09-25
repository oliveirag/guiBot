import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { RPS, RPS_EMOJI, pick, rpsResult, type Rps } from '../lib/random.js';

const LINE = { win: 'You win.', lose: 'I win.', tie: 'Tie.' };

export default command({
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Rock, paper, scissors against guiBot.')
    .addStringOption((o) =>
      o
        .setName('pick')
        .setDescription('Your throw')
        .setRequired(true)
        .addChoices(...RPS.map((r) => ({ name: r, value: r }))),
    ),
  cooldownSeconds: 2,
  async run({ interaction }) {
    const you = interaction.options.getString('pick', true) as Rps;
    const me = pick(RPS);
    await interaction.reply({ embeds: [info(`${RPS_EMOJI[you]} vs ${RPS_EMOJI[me]}\n**${LINE[rpsResult(you, me)]}**`)] });
  },
});
