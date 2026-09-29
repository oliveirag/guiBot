import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { canPost } from '../../dev/lib/feeds.js';
import { parseDuration } from '../../mod/lib/duration.js';
import { sendTo } from '../../sd/lib/post.js';
import {
  MAX_WINNERS,
  activeGiveaways,
  createGiveaway,
  finishGiveaway,
  getGiveaway,
  renderGiveaway,
  rerollGiveaway,
} from '../lib/giveaways.js';

const numberOption = (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s.addIntegerOption((o) => o.setName('number').setDescription('Giveaway number (in its footer)').setRequired(true).setMinValue(1));

export default command({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways people enter with a button.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway.')
        .addStringOption((o) => o.setName('prize').setDescription('What they win').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duration').setDescription('How long it runs, like 1h, 3d, 1w').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('winners').setDescription('How many win (default 1)').setMinValue(1).setMaxValue(MAX_WINNERS),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post it (default here)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) => numberOption(s.setName('end').setDescription('End a giveaway now and draw winners.')))
    .addSubcommand((s) =>
      numberOption(s.setName('reroll').setDescription('Draw new winners for an ended giveaway.')).addIntegerOption((o) =>
        o.setName('count').setDescription('How many to draw (default 1)').setMinValue(1).setMaxValue(MAX_WINNERS),
      ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Giveaways still running.')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { guildId, client } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const running = await activeGiveaways(guildId);
      const lines = running.map((g) => `**#${g.number}** ${g.prize} · <#${g.channelId}> · ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`);
      const text = lines.length > 0 ? lines.join('\n') : 'Nothing running. Start one with `/giveaway start`.';
      await interaction.reply({ embeds: [info(text, 'Giveaways')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'end') {
      const g = await getGiveaway(guildId, interaction.options.getInteger('number', true));
      if (g.ended) throw new UserError(`Giveaway #${g.number} already ended. Use \`/giveaway reroll\` to draw again.`);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winners = await finishGiveaway(client, g.id);
      const text = winners === null ? `Giveaway #${g.number} just ended on its own.` : `Ended giveaway #${g.number}.`;
      await interaction.editReply({ embeds: [ok(text)] });
      return;
    }

    if (sub === 'reroll') {
      const g = await getGiveaway(guildId, interaction.options.getInteger('number', true));
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winners = await rerollGiveaway(client, g, interaction.options.getInteger('count') ?? 1);
      const text = winners.length > 0 ? `Rerolled giveaway #${g.number}.` : `Nobody left to draw for giveaway #${g.number}.`;
      await interaction.editReply({ embeds: [ok(text)] });
      return;
    }

    const channel =
      interaction.options.getChannel('channel', false, [ChannelType.GuildText, ChannelType.GuildAnnouncement]) ?? interaction.channel;
    if (!channel || channel.isDMBased() || !canPost(channel.permissionsFor(client.user))) {
      throw new UserError(`I can't post in ${channel ?? 'that channel'}. I need View Channel, Send Messages, and Embed Links there.`);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const g = await createGiveaway({
      guildId,
      channelId: channel.id,
      hostId: interaction.user.id,
      prize: interaction.options.getString('prize', true),
      winnerCount: interaction.options.getInteger('winners') ?? 1,
      seconds: parseDuration(interaction.options.getString('duration', true)),
    });
    const message = await sendTo(client, channel.id, { ...renderGiveaway(g, 0), allowedMentions: { parse: [] } });
    if (!message) {
      // Its end job finds nothing and skips.
      await prisma.giveaway.delete({ where: { id: g.id } });
      throw new UserError(`I couldn't post in ${channel}.`);
    }
    await prisma.giveaway.update({ where: { id: g.id }, data: { messageId: message.id } });
    await interaction.editReply({ embeds: [ok(`Giveaway #${g.number} is live: ${message.url}`)] });
  },
});
