import { ChannelType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { canPost } from '../dev/lib/feeds.js';
import { assertAssignable } from '../roles/lib/assignable.js';
import { formatClock, isValidTimeZone, parseClock, stamp } from '../sd/lib/time.js';
import { scheduleNextBirthdays } from './lib/birthdays.js';
import { DEFAULT_JOIN, DEFAULT_LEAVE, TEMPLATE_HELP, getWelcome, updateWelcome } from './lib/greet.js';

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

function postable(interaction: ChatInputCommandInteraction<'cached'>) {
  const channel = interaction.options.getChannel('channel', true, [...TEXT]);
  if (!canPost(channel.permissionsFor(interaction.client.user))) {
    throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
  }
  return channel;
}

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('join')
          .setDescription(`Greet new members in a channel. ${TEMPLATE_HELP}`)
          .addChannelOption((o) => o.setName('channel').setDescription('Where').setRequired(true).addChannelTypes(...TEXT))
          .addStringOption((o) => o.setName('message').setDescription('Message template').setMaxLength(1500))
          .addBooleanOption((o) => o.setName('embed').setDescription('Send as an embed (default yes)')),
      )
      .addSubcommand((s) => s.setName('join-off').setDescription('Stop welcome messages.'))
      .addSubcommand((s) =>
        s
          .setName('leave')
          .setDescription(`Post when someone leaves. ${TEMPLATE_HELP}`)
          .addChannelOption((o) => o.setName('channel').setDescription('Where').setRequired(true).addChannelTypes(...TEXT))
          .addStringOption((o) => o.setName('message').setDescription('Message template').setMaxLength(1500))
          .addBooleanOption((o) => o.setName('embed').setDescription('Send as an embed (default no)')),
      )
      .addSubcommand((s) => s.setName('leave-off').setDescription('Stop leave messages.'))
      .addSubcommand((s) =>
        s
          .setName('dm')
          .setDescription(`DM new members. Leave the message empty to stop. ${TEMPLATE_HELP}`)
          .addStringOption((o) => o.setName('message').setDescription('Message template').setMaxLength(1500)),
      )
      .addSubcommand((s) =>
        s
          .setName('birthdays')
          .setDescription('Post birthdays every day, and optionally give a role for the day.')
          .addChannelOption((o) => o.setName('channel').setDescription('Where').setRequired(true).addChannelTypes(...TEXT))
          .addRoleOption((o) => o.setName('role').setDescription('Birthday role for the day'))
          .addStringOption((o) => o.setName('time').setDescription('Like 9am (default 09:00)'))
          .addStringOption((o) => o.setName('timezone').setDescription('Like America/New_York')),
      )
      .addSubcommand((s) => s.setName('birthdays-off').setDescription('Stop birthday posts.'))
      .addSubcommand((s) => s.setName('show').setDescription('Show welcome settings.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'join': {
        const channel = postable(interaction);
        await updateWelcome(guildId, {
          joinChannelId: channel.id,
          ...(interaction.options.getString('message') ? { joinMessage: interaction.options.getString('message') } : {}),
          joinEmbed: interaction.options.getBoolean('embed') ?? true,
        });
        await reply(`New members get greeted in ${channel}. Try it with \`/welcome test\`.`);
        return;
      }
      case 'join-off':
        await updateWelcome(guildId, { joinChannelId: null });
        await reply('Welcome messages are off.');
        return;
      case 'leave': {
        const channel = postable(interaction);
        await updateWelcome(guildId, {
          leaveChannelId: channel.id,
          ...(interaction.options.getString('message') ? { leaveMessage: interaction.options.getString('message') } : {}),
          leaveEmbed: interaction.options.getBoolean('embed') ?? false,
        });
        await reply(`Leaves get posted in ${channel}.`);
        return;
      }
      case 'leave-off':
        await updateWelcome(guildId, { leaveChannelId: null });
        await reply('Leave messages are off.');
        return;
      case 'dm': {
        const message = interaction.options.getString('message');
        await updateWelcome(guildId, { dmMessage: message || null });
        await reply(message ? 'New members get a DM.' : 'No more welcome DMs.');
        return;
      }
      case 'birthdays': {
        const channel = postable(interaction);
        const role = interaction.options.getRole('role');
        if (role) await assertAssignable(interaction, role);
        const zone = interaction.options.getString('timezone')?.trim();
        if (zone && !isValidTimeZone(zone)) throw new UserError(`"${zone}" isn't a timezone I know. Try America/New_York.`);
        const rawTime = interaction.options.getString('time');
        const current = await getWelcome(guildId);
        const now = new Date();
        const at = await prisma.$transaction(async (tx) => {
          const s = await tx.welcomeSettings.upsert({
            where: { guildId },
            create: { guildId },
            update: {},
          });
          const updated = await tx.welcomeSettings.update({
            where: { guildId },
            data: {
              birthdayChannelId: channel.id,
              birthdayRoleId: role?.id ?? current?.birthdayRoleId ?? null,
              ...(rawTime ? { birthdayTime: formatClock(parseClock(rawTime)) } : {}),
              ...(zone ? { timezone: zone } : {}),
              birthdayVersion: s.birthdayVersion + 1,
            },
          });
          return scheduleNextBirthdays(updated, now, tx);
        });
        await reply(`Birthdays post in ${channel} every day${role ? ` and get ${role}` : ''}.${at ? ` Next check ${stamp(at, 'f')}.` : ''}`);
        return;
      }
      case 'birthdays-off': {
        const s = await getWelcome(guildId);
        await updateWelcome(guildId, { birthdayChannelId: null, birthdayVersion: (s?.birthdayVersion ?? 0) + 1 });
        await reply('Birthday posts are off. Saved birthdays stay saved.');
        return;
      }
      default: {
        const s = await getWelcome(guildId);
        const birthdays = await prisma.birthday.count({ where: { guildId } });
        const lines = [
          `**Join** ${s?.joinChannelId ? `<#${s.joinChannelId}>${s.joinEmbed ? ' (embed)' : ''}\n> ${s.joinMessage ?? DEFAULT_JOIN}` : 'off'}`,
          `**Leave** ${s?.leaveChannelId ? `<#${s.leaveChannelId}>\n> ${s.leaveMessage ?? DEFAULT_LEAVE}` : 'off'}`,
          `**DM** ${s?.dmMessage ? `\n> ${s.dmMessage}` : 'off'}`,
          `**Birthdays** ${s?.birthdayChannelId ? `<#${s.birthdayChannelId}> at ${s.birthdayTime} ${s.timezone}${s.birthdayRoleId ? ` · <@&${s.birthdayRoleId}>` : ''}` : 'off'} · ${birthdays} saved`,
        ];
        await interaction.reply({ embeds: [info(lines.join('\n').slice(0, 4096), 'Welcome')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const s = await getWelcome(guildId);
    const on = [s?.joinChannelId && 'join', s?.leaveChannelId && 'leave', s?.dmMessage && 'dm', s?.birthdayChannelId && 'birthdays'].filter(Boolean);
    return on.length > 0 ? on.join(', ') : 'nothing on';
  },
});
