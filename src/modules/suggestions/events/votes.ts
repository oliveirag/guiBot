import { Events, MessageFlags, type Interaction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { authorOf } from '../lib/publish.js';
import { VOTE_PREFIX, renderSuggestion, tally, vote } from '../lib/suggestions.js';

const RESULT = { added: 'Vote counted.', removed: 'Vote taken back.', switched: 'Vote switched.' };

export default event({
  name: Events.InteractionCreate,
  async run(interaction: Interaction) {
    if (!interaction.inCachedGuild() || !interaction.isButton() || !interaction.customId.startsWith(VOTE_PREFIX)) return;
    try {
      const [id, direction] = interaction.customId.slice(VOTE_PREFIX.length).split(':');
      const s = await prisma.suggestion.findFirst({ where: { id: Number(id), guildId: interaction.guildId } });
      if (!s) throw new UserError("That suggestion doesn't exist anymore.");
      if (s.status === 'approved' || s.status === 'denied') throw new UserError('Voting on this one is closed.');
      const result = await vote(s.id, interaction.user.id, direction === 'up' ? 1 : -1);
      await interaction.update(renderSuggestion(s, await tally(s.id), await authorOf(interaction.client, s.authorId)));
      await interaction.followUp({ embeds: [ok(RESULT[result])], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await reportError(interaction, error, log);
    }
  },
});
