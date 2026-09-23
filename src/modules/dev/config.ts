import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { SOURCE_LABEL, addFeed, canPost, describeFeeds, listFeeds, removeFeed } from './lib/feeds.js';
import type { FeedSource } from './lib/types.js';

const SOURCES = [
  { name: 'GitHub', value: 'github' },
  { name: 'Jira', value: 'jira' },
];

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Post a GitHub repo or Jira project to a channel.')
          .addStringOption((o) =>
            o.setName('source').setDescription('Where events come from').setRequired(true).addChoices(...SOURCES),
          )
          .addStringOption((o) =>
            o.setName('target').setDescription('GitHub owner/repo or Jira project key').setRequired(true),
          )
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to post in')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Stop posting a repo or project.')
          .addStringOption((o) =>
            o.setName('source').setDescription('Where events come from').setRequired(true).addChoices(...SOURCES),
          )
          .addStringOption((o) =>
            o.setName('target').setDescription('GitHub owner/repo or Jira project key').setRequired(true),
          ),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Show where each repo and project posts.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const embed = info(describeFeeds(await listFeeds(guildId)), 'Dev feeds').setFooter({
        text: 'Webhooks go to POST /webhooks/github and /webhooks/jira',
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const source = interaction.options.getString('source', true) as FeedSource;
    const target = interaction.options.getString('target', true);

    if (sub === 'remove') {
      const key = await removeFeed(guildId, source, target);
      await interaction.reply({
        embeds: [ok(`${SOURCE_LABEL[source]} **${key}** won't post here anymore.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    if (!canPost(channel.permissionsFor(interaction.client.user))) {
      throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
    }
    const { key, moved } = await addFeed(guildId, source, target, channel.id);
    await interaction.reply({
      embeds: [ok(`${SOURCE_LABEL[source]} **${key}** now posts in ${channel}.${moved ? ' Moved from its old channel.' : ''}`)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async view(guildId) {
    const count = await prisma.devFeed.count({ where: { guildId } });
    return count === 0 ? 'no feeds yet' : `${count} feed${count === 1 ? '' : 's'}`;
  },
});
