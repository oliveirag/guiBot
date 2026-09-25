import { Events, MessageFlags, type Interaction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { TTT_PREFIX, decode, play, render } from '../lib/tictactoe.js';
import { TRIVIA_PREFIX, guess, rounds } from '../lib/trivia.js';

export default event({
  name: Events.InteractionCreate,
  async run(interaction: Interaction) {
    if (!interaction.isButton()) return;
    const id = interaction.customId;
    if (!id.startsWith(TTT_PREFIX) && !id.startsWith(TRIVIA_PREFIX)) return;
    try {
      if (id.startsWith(TTT_PREFIX)) {
        const parsed = decode(id);
        if (!parsed) throw new UserError("That game's broken. Start a new one with `/tictactoe`.");
        const result = play(parsed.game, parsed.cell, interaction.user.id);
        if (!result.ok) throw new UserError(result.reason);
        await interaction.update({ ...render(result.game), allowedMentions: { parse: [] } });
        return;
      }
      const [roundId, answer] = id.slice(TRIVIA_PREFIX.length).split(':');
      const round = rounds.get(roundId ?? '');
      if (!round) throw new UserError('This round is over.');
      if (!guess(round, interaction.user.id, Number(answer))) throw new UserError('You already guessed. Answer shows soon.');
      await interaction.reply({ embeds: [ok('Locked in.')], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await reportError(interaction, error, log);
    }
  },
});
