import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { prisma } from '../../../db.js';

const MAX_NOTES = 50;

export default command({
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Private mod notes on a member. They never see them.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a note.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription("Show someone's notes.")
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const user = interaction.options.getUser('user', true);

    if (interaction.options.getSubcommand() === 'add') {
      const count = await prisma.modNote.count({ where: { guildId, userId: user.id } });
      if (count >= MAX_NOTES) {
        const oldest = await prisma.modNote.findFirst({ where: { guildId, userId: user.id }, orderBy: { id: 'asc' } });
        if (oldest) await prisma.modNote.delete({ where: { id: oldest.id } });
      }
      await prisma.modNote.create({
        data: { guildId, userId: user.id, authorId: interaction.user.id, text: interaction.options.getString('text', true) },
      });
      await interaction.reply({ embeds: [ok(`Noted on **${user.tag}**.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const notes = await prisma.modNote.findMany({ where: { guildId, userId: user.id }, orderBy: { id: 'desc' }, take: 20 });
    const body =
      notes.length > 0
        ? notes.map((n) => `<t:${Math.floor(n.createdAt.getTime() / 1000)}:d> <@${n.authorId}>: ${n.text}`).join('\n')
        : 'No notes.';
    await interaction.reply({ embeds: [info(body.slice(0, 4096), `Notes on ${user.tag}`)], flags: MessageFlags.Ephemeral });
  },
});
