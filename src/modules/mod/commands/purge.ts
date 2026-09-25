import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { pickPurge } from '../lib/channels.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete recent messages here (last 100 scanned, nothing older than 14 days).')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('count').setDescription('How many to delete').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only this person'))
    .addBooleanOption((o) => o.setName('bots').setDescription('Only bots'))
    .addBooleanOption((o) => o.setName('links').setDescription('Only messages with links'))
    .addStringOption((o) => o.setName('match').setDescription('Only messages containing this text')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageMessages,
  cooldownSeconds: 5,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.channel;
    if (!channel || !('bulkDelete' in channel)) throw new UserError("I can't purge in this kind of channel.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const recent = await channel.messages.fetch({ limit: 100 });
    const ids = pickPurge(
      [...recent.values()].map((m) => ({
        id: m.id,
        authorId: m.author.id,
        authorBot: m.author.bot,
        content: m.content,
        createdTimestamp: m.createdTimestamp,
        pinned: m.pinned,
      })),
      {
        userId: interaction.options.getUser('user')?.id,
        bots: interaction.options.getBoolean('bots') ?? false,
        links: interaction.options.getBoolean('links') ?? false,
        match: interaction.options.getString('match'),
      },
      interaction.options.getInteger('count', true),
    );
    if (ids.length === 0) throw new UserError('Nothing matched.');
    const deleted = await channel.bulkDelete(ids, true);
    await interaction.editReply({ embeds: [ok(`Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}.`)] });
  },
});
