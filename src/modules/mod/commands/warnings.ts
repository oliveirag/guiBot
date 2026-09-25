import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { prisma } from '../../../db.js';
import { caseLine } from '../lib/cases.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("Show someone's warns. Removed ones are struck through.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    const warns = await prisma.modCase.findMany({
      where: { guildId: interaction.guildId, userId: user.id, action: 'warn' },
      orderBy: { number: 'desc' },
      take: 25,
    });
    const active = warns.filter((w) => w.active).length;
    const body = warns.length > 0 ? warns.map(caseLine).join('\n') : 'No warns. Clean record.';
    await interaction.reply({
      embeds: [info(body.slice(0, 4096), `${user.tag} · ${active} active warn${active === 1 ? '' : 's'}`)],
      flags: MessageFlags.Ephemeral,
    });
  },
});
