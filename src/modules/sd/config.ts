import { ChannelType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { canPost } from '../dev/lib/feeds.js';
import { refreshBoard } from './lib/deadlines.js';
import { configureDigest, disableDigest, scheduleNextDigest } from './lib/digest.js';
import { getSettings, updateSettings } from './lib/settings.js';
import { scheduleNextOpen } from './lib/standups.js';
import { csvDays, formatDays, isValidTimeZone, parseClock, stamp, weekdayLabel } from './lib/time.js';

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const DAY_CHOICES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
  (name, value) => ({ name, value }),
);

function postableChannel(interaction: ChatInputCommandInteraction<'cached'>) {
  const channel = interaction.options.getChannel('channel', true, [...TEXT_CHANNELS]);
  if (!canPost(channel.permissionsFor(interaction.client.user))) {
    throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
  }
  return channel;
}

const next = (at: Date | null): string => (at ? ` Next one ${stamp(at, 'f')}.` : '');

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('digest')
          .setDescription('Post a weekly digest of who did what.')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Where the digest goes')
              .setRequired(true)
              .addChannelTypes(...TEXT_CHANNELS),
          )
          .addIntegerOption((o) =>
            o.setName('day').setDescription('Day to post (default Friday)').addChoices(...DAY_CHOICES),
          )
          .addStringOption((o) => o.setName('time').setDescription('Like 5pm (default 17:00)')),
      )
      .addSubcommand((s) => s.setName('digest-off').setDescription('Stop the weekly digest.'))
      .addSubcommand((s) =>
        s
          .setName('deadlines')
          .setDescription('Where deadline reminders and the upcoming board post.')
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Deadlines channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('timezone')
          .setDescription('Timezone for standups, the digest, and dates you type.')
          .addStringOption((o) => o.setName('zone').setDescription('Like America/New_York').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Show Senior Design settings.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (sub) {
      case 'digest': {
        const channel = postableChannel(interaction);
        const day = interaction.options.getInteger('day') ?? 5;
        const clock = parseClock(interaction.options.getString('time') ?? '17:00');
        const at = await configureDigest(guildId, { channelId: channel.id, day, clock });
        await reply(`The weekly digest posts in ${channel} every ${weekdayLabel(day)}.${next(at)}`);
        return;
      }
      case 'digest-off':
        await disableDigest(guildId);
        await reply('The weekly digest is off.');
        return;
      case 'deadlines': {
        const channel = postableChannel(interaction);
        await updateSettings(guildId, { deadlineChannelId: channel.id, boardMessageId: null });
        await refreshBoard(interaction.client, guildId);
        await reply(`Deadline reminders and the upcoming board post in ${channel}.`);
        return;
      }
      case 'timezone': {
        const zone = interaction.options.getString('zone', true).trim();
        if (!isValidTimeZone(zone)) {
          throw new UserError(`"${zone}" isn't a timezone I know. Use a name like America/New_York or Europe/London.`);
        }
        // New versions retire jobs queued in the old zone; the next ones are queued in the new zone.
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          const current = await getSettings(guildId, tx);
          const updated = await updateSettings(
            guildId,
            { timezone: zone, standupVersion: current.standupVersion + 1, digestVersion: current.digestVersion + 1 },
            tx,
          );
          await scheduleNextOpen(updated, now, tx);
          await scheduleNextDigest(updated, now, tx);
        });
        await reply(`Timezone set to ${zone}.`);
        return;
      }
      default: {
        const s = await getSettings(guildId);
        const standup = s.standupChannelId
          ? `<#${s.standupChannelId}> ${formatDays(csvDays(s.standupDays))} at ${s.standupTime}, summary after ${s.standupWindowHours}h`
          : 'off (turn on with /standup config)';
        const lines = [
          `**Timezone** ${s.timezone}`,
          `**Standups** ${standup}`,
          `**Digest** ${s.digestChannelId ? `<#${s.digestChannelId}> ${weekdayLabel(s.digestDay)} at ${s.digestTime}` : 'off'}`,
          `**Deadlines** ${s.deadlineChannelId ? `<#${s.deadlineChannelId}>` : 'no channel, so no reminders'}`,
          `**Team** ${await prisma.sdMember.count({ where: { guildId } })} linked`,
        ];
        await interaction.reply({ embeds: [info(lines.join('\n'), 'Senior Design')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const s = await getSettings(guildId);
    const team = await prisma.sdMember.count({ where: { guildId } });
    return [
      `${team} linked`,
      s.standupChannelId ? `standups ${formatDays(csvDays(s.standupDays))} ${s.standupTime}` : 'standups off',
      s.digestChannelId ? `digest ${weekdayLabel(s.digestDay)} ${s.digestTime}` : 'digest off',
    ].join(' · ');
  },
});
