import { Events, MessageFlags, type Interaction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { GA_PREFIX, entryCount, renderGiveaway, toggleEntry } from '../lib/giveaways.js';

const RESULT = { entered: "You're in. Good luck!", left: "You're out." };

export default event({
  name: Events.InteractionCreate,
  async run(interaction: Interaction) {
    if (!interaction.inCachedGuild() || !interaction.isButton() || !interaction.customId.startsWith(GA_PREFIX)) return;
    try {
      const id = Number(interaction.customId.slice(GA_PREFIX.length));
      const g = await prisma.giveaway.findFirst({ where: { id, guildId: interaction.guildId } });
      if (!g) throw new UserError("That giveaway doesn't exist anymore.");
      if (g.ended || g.endsAt <= new Date()) throw new UserError('This giveaway is over.');
      const result = await toggleEntry(g.id, interaction.user.id);
      await interaction.update(renderGiveaway(g, await entryCount(g.id)));
      await interaction.followUp({ embeds: [ok(RESULT[result])], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await reportError(interaction, error, log);
    }
  },
});
