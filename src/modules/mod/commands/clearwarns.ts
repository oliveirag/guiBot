import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { clearWarns } from '../lib/cases.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription("Remove all of someone's active warns.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    const count = await clearWarns(interaction.guildId, user.id);
    await interaction.reply({
      embeds: [ok(count > 0 ? `Cleared ${count} warn${count === 1 ? '' : 's'} from **${user.tag}**.` : `**${user.tag}** had no active warns.`)],
    });
  },
});
