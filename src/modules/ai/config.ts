import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { MAX_AI_CHANNELS, getAiConfig, setAiChannel, setAiCooldown } from './lib/settings.js';

const channelList = (ids: ReadonlySet<string>): string =>
  ids.size > 0 ? `on everywhere except ${[...ids].map((id) => `<#${id}>`).join(', ')}` : 'on everywhere';

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('AI replies (/ask and @mentions) are on everywhere. Turn them off or back on in a channel.')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('The channel')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum),
          )
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('cooldown')
          .setDescription('Seconds each person waits between AI replies (0 for none).')
          .addIntegerOption((o) =>
            o.setName('seconds').setDescription('Default 20').setRequired(true).setMinValue(0).setMaxValue(3600),
          ),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Show AI settings.')),

  async run({ interaction, env }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'channel': {
        const channel = interaction.options.getChannel('channel', true);
        const enabled = interaction.options.getBoolean('enabled', true);
        try {
          await setAiChannel(guildId, channel.id, enabled);
        } catch (error) {
          if (error instanceof RangeError) throw new UserError(`AI can be off in at most ${MAX_AI_CHANNELS} channels.`);
          throw error;
        }
        const warn = env.gemini ? '' : ' Heads up: GEMINI_API_KEY isn\'t set, so nothing will answer yet.';
        await reply(`AI is ${enabled ? 'on' : 'off'} in ${channel}.${warn}`);
        return;
      }
      case 'cooldown': {
        const seconds = interaction.options.getInteger('seconds', true);
        await setAiCooldown(guildId, seconds);
        await reply(seconds === 0 ? 'No AI cooldown now.' : `Each person waits ${seconds}s between AI replies.`);
        return;
      }
      default: {
        const config = await getAiConfig(guildId);
        const lines = [
          `**Channels** ${channelList(config.offChannelIds)}`,
          `**Cooldown** ${config.cooldownSeconds}s per person`,
          `**Model** ${env.gemini ? env.gemini.model : 'not set up (GEMINI_API_KEY missing)'}`,
        ];
        await interaction.reply({ embeds: [info(lines.join('\n'), 'AI')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const config = await getAiConfig(guildId);
    const off = config.offChannelIds.size;
    return `${off > 0 ? `off in ${off} channel${off === 1 ? '' : 's'}` : 'on everywhere'} · ${config.cooldownSeconds}s cooldown`;
  },
});
