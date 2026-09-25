import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { UserError } from '../../../core/errors.js';
import { BOT, newGame, render } from '../lib/tictactoe.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('tictactoe')
    .setDescription('Play tic-tac-toe with someone, or against guiBot.')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('opponent').setDescription('Who to play (default: guiBot)')),
  guildOnly: true,
  cooldownSeconds: 5,
  async run({ interaction }) {
    const opponent = interaction.options.getUser('opponent');
    if (opponent?.id === interaction.user.id) throw new UserError("You can't play yourself. Leave opponent empty to play me.");
    if (opponent?.bot && opponent.id !== interaction.client.user.id) throw new UserError("Other bots don't know how to play.");
    const o = !opponent || opponent.id === interaction.client.user.id ? BOT : opponent.id;
    await interaction.reply({
      ...render(newGame(interaction.user.id, o)),
      ...(o !== BOT ? { content: `<@${o}>, you've been challenged.` } : {}),
      allowedMentions: { users: o !== BOT ? [o] : [] },
    });
  },
});
