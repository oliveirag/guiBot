import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { canPost } from '../../dev/lib/feeds.js';
import { profileUrl } from '../lib/render.js';
import { lastWatcherCheckIn, listTracks, parseProfileId, trackProfile, untrackProfile } from '../lib/tracks.js';

const WATCHER_STALE_MS = 2 * 60_000;

export default command({
  data: new SlashCommandBuilder()
    .setName('pp')
    .setDescription('Post new PrizePicks slips from profiles you follow.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('track')
        .setDescription('Post new slips from a PrizePicks profile.')
        .addStringOption((o) => o.setName('profile').setDescription('Share link or profile id, like go0QDE3G').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where slips go (default here)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('untrack')
        .setDescription('Stop posting slips from a profile.')
        .addStringOption((o) => o.setName('profile').setDescription('Share link or profile id').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Profiles this server tracks.')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { guildId, client } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const tracks = await listTracks(guildId);
      const lines = tracks.map(
        (t) => `[${t.username ?? t.profileId}](${profileUrl(t.profileId)}) → <#${t.channelId}>${t.baselined ? '' : ' · waiting on first check'}`,
      );
      const seen = lastWatcherCheckIn();
      const watcher =
        seen && Date.now() - seen.getTime() < WATCHER_STALE_MS
          ? `Watcher checked in <t:${Math.floor(seen.getTime() / 1000)}:R>.`
          : "⚠️ The watcher isn't running, so no slips are coming in. Start it on the Mac with `npm run pp:watch`.";
      const text = [lines.length > 0 ? lines.join('\n') : 'Not tracking anyone. Add someone with `/pp track`.', '', watcher].join('\n');
      await interaction.reply({ embeds: [info(text, 'PrizePicks')], flags: MessageFlags.Ephemeral });
      return;
    }

    const profileId = parseProfileId(interaction.options.getString('profile', true));
    if (sub === 'untrack') {
      const t = await untrackProfile(guildId, profileId);
      await interaction.reply({ embeds: [ok(`Stopped tracking ${t.username ?? profileId}.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const channel =
      interaction.options.getChannel('channel', false, [ChannelType.GuildText, ChannelType.GuildAnnouncement]) ?? interaction.channel;
    if (!channel || channel.isDMBased() || !canPost(channel.permissionsFor(client.user))) {
      throw new UserError(`I can't post in ${channel ?? 'that channel'}. I need View Channel, Send Messages, and Embed Links there.`);
    }
    const { moved } = await trackProfile({ guildId, profileId, channelId: channel.id, addedById: interaction.user.id });
    const text = moved
      ? `\`${profileId}\` slips go to ${channel} now.`
      : `Tracking \`${profileId}\`. New slips post in ${channel} within a few seconds. Slips already open won't be posted.`;
    await interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });
  },
});
