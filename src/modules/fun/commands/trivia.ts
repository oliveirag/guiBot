import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { CATEGORIES, ROUND_SECONDS, fetchQuestion, renderRound, rounds, winnersOf } from '../lib/trivia.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription(`A trivia question. Everyone gets one guess, answer shows after ${ROUND_SECONDS}s.`)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o
        .setName('category')
        .setDescription('Topic (default: anything)')
        .addChoices(...CATEGORIES.map((c) => ({ name: c.name, value: c.value }))),
    )
    .addStringOption((o) =>
      o
        .setName('difficulty')
        .setDescription('Default: any')
        .addChoices({ name: 'Easy', value: 'easy' }, { name: 'Medium', value: 'medium' }, { name: 'Hard', value: 'hard' }),
    ),
  guildOnly: true,
  cooldownSeconds: 10,
  async run({ interaction }) {
    await interaction.deferReply();
    const question = await fetchQuestion({
      category: interaction.options.getInteger('category'),
      difficulty: interaction.options.getString('difficulty'),
    });
    const roundId = interaction.id;
    const round = { question, guesses: new Map<string, number>() };
    rounds.set(roundId, round);
    await interaction.editReply(renderRound(roundId, question));
    setTimeout(() => {
      rounds.delete(roundId);
      const reveal = { winners: winnersOf(round), guessers: round.guesses.size };
      interaction.editReply(renderRound(roundId, question, reveal)).catch((error) => log.warn('fun: trivia reveal failed', error));
    }, ROUND_SECONDS * 1000);
  },
});
