import { ChannelType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { canPost } from '../dev/lib/feeds.js';
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
      default: {
        const s = await getWelcome(guildId);
        const lines = [
          `**Join** ${s?.joinChannelId ? `<#${s.joinChannelId}>${s.joinEmbed ? ' (embed)' : ''}\n> ${s.joinMessage ?? DEFAULT_JOIN}` : 'off'}`,
          `**Leave** ${s?.leaveChannelId ? `<#${s.leaveChannelId}>\n> ${s.leaveMessage ?? DEFAULT_LEAVE}` : 'off'}`,
          `**DM** ${s?.dmMessage ? `\n> ${s.dmMessage}` : 'off'}`,
        ];
        await interaction.reply({ embeds: [info(lines.join('\n').slice(0, 4096), 'Welcome')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const s = await getWelcome(guildId);
    const on = [s?.joinChannelId && 'join', s?.leaveChannelId && 'leave', s?.dmMessage && 'dm'].filter(Boolean);
    return on.length > 0 ? on.join(', ') : 'nothing on';
  },
});
