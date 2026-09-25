import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { canPost } from '../dev/lib/feeds.js';
import { LOG_KINDS, LOG_LABELS, getRoutes, setRoute, type LogKind } from './lib/routes.js';

const KIND_CHOICES = [
  ...LOG_KINDS.map((k) => ({ name: `${k}: ${LOG_LABELS[k]}`, value: k })),
  { name: 'all: every kind', value: 'all' },
];

const kindsFrom = (raw: string): LogKind[] => (raw === 'all' ? [...LOG_KINDS] : [raw as LogKind]);

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Send a kind of log to a channel.')
          .addStringOption((o) => o.setName('kind').setDescription('What to log').setRequired(true).addChoices(...KIND_CHOICES))
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Log channel')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('off')
          .setDescription('Stop logging a kind.')
          .addStringOption((o) => o.setName('kind').setDescription('What to stop').setRequired(true).addChoices(...KIND_CHOICES)),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Show where each log goes.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'show') {
      const routes = await getRoutes(guildId);
      const lines = LOG_KINDS.map((k) => `**${k}** ${routes.has(k) ? `<#${routes.get(k)}>` : 'off'} · ${LOG_LABELS[k]}`);
      await interaction.reply({ embeds: [info(lines.join('\n'), 'Logs')], flags: MessageFlags.Ephemeral });
      return;
    }

    const kinds = kindsFrom(interaction.options.getString('kind', true));
    if (sub === 'off') {
      for (const k of kinds) await setRoute(guildId, k, null);
      await interaction.reply({ embeds: [ok(`Stopped logging ${kinds.join(', ')}.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    if (!canPost(channel.permissionsFor(interaction.client.user))) {
      throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
    }
    for (const k of kinds) await setRoute(guildId, k, channel.id);
    await interaction.reply({ embeds: [ok(`${kinds.join(', ')} logs go to ${channel}.`)], flags: MessageFlags.Ephemeral });
  },

  async view(guildId) {
    const routes = await getRoutes(guildId);
    return routes.size > 0 ? [...routes.keys()].join(', ') : 'nothing logged';
  },
});
