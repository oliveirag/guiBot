import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { canPost } from '../dev/lib/feeds.js';

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Where /suggest posts go.')
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Suggestions channel').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addBooleanOption((o) => o.setName('threads').setDescription('Open a discussion thread on each (default yes)')),
      )
      .addSubcommand((s) => s.setName('off').setDescription('Turn /suggest off.'))
      .addSubcommand((s) => s.setName('show').setDescription('Show suggestion settings.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText]);
      const me = interaction.client.user;
      if (!canPost(channel.permissionsFor(me))) {
        throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
      }
      const threads = interaction.options.getBoolean('threads') ?? true;
      if (threads && !channel.permissionsFor(me)?.has('CreatePublicThreads')) {
        throw new UserError(`I need Create Public Threads in ${channel}, or set threads to false.`);
      }
      await prisma.suggestionSettings.upsert({
        where: { guildId },
        create: { guildId, channelId: channel.id, threads },
        update: { channelId: channel.id, threads },
      });
      await reply(`Suggestions go to ${channel}${threads ? ', each with its own thread' : ''}.`);
      return;
    }
    if (sub === 'off') {
      await prisma.suggestionSettings.upsert({ where: { guildId }, create: { guildId }, update: { channelId: null } });
      await reply('/suggest is off. Old suggestions stay where they are.');
      return;
    }
    const s = await prisma.suggestionSettings.findUnique({ where: { guildId } });
    const counts = await prisma.suggestion.groupBy({ by: ['status'], where: { guildId }, _count: true });
    const byStatus = counts.map((c) => `${c.status} ${c._count}`).join(' · ') || 'none yet';
    const lines = [`**Channel** ${s?.channelId ? `<#${s.channelId}>` : 'off'}`, `**Threads** ${s?.threads === false ? 'off' : 'on'}`, `**Suggestions** ${byStatus}`];
    await interaction.reply({ embeds: [info(lines.join('\n'), 'Suggestions')], flags: MessageFlags.Ephemeral });
  },

  async view(guildId) {
    const s = await prisma.suggestionSettings.findUnique({ where: { guildId } });
    return s?.channelId ? `posting in <#${s.channelId}>` : 'off';
  },
});
