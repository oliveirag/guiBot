import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { MAX_POLL_HOURS, buildPoll, parseAnswers } from '../lib/poll.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Start a native Discord poll.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('question').setDescription('What are you asking?').setRequired(true).setMaxLength(300))
    .addStringOption((o) => o.setName('answers').setDescription('2 to 10 answers split with |, like Pizza | Tacos | Sushi').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('hours').setDescription('How long it runs (default 24, max 768)').setMinValue(1).setMaxValue(MAX_POLL_HOURS),
    )
    .addBooleanOption((o) => o.setName('multi').setDescription('Let people pick more than one (default no)')),
  guildOnly: true,
  cooldownSeconds: 10,

  async run({ interaction }) {
    const answers = parseAnswers(interaction.options.getString('answers', true));
    const poll = buildPoll(
      interaction.options.getString('question', true),
      answers,
      interaction.options.getInteger('hours') ?? 24,
      interaction.options.getBoolean('multi') ?? false,
    );
    await interaction.reply({ poll });
  },
});
