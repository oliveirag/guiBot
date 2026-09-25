import { MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { MAX_TIMEOUT_SECONDS } from './lib/checks.js';
import { formatDuration, parseDuration } from './lib/duration.js';
import { ESCALATIONS, getModSettings, updateModSettings } from './lib/settings.js';

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('dm')
          .setDescription('DM people when they get warned, timed out, kicked, or banned.')
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off (default on)').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('escalate')
          .setDescription('Punish automatically when someone reaches a number of active warns.')
          .addIntegerOption((o) => o.setName('warns').setDescription('How many warns').setRequired(true).setMinValue(1).setMaxValue(20))
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('What happens')
              .setRequired(true)
              .addChoices(...ESCALATIONS.map((a) => ({ name: a, value: a }))),
          )
          .addStringOption((o) => o.setName('duration').setDescription('For timeouts (default 1h) or temp bans, like 1d')),
      )
      .addSubcommand((s) => s.setName('escalate-off').setDescription('Stop escalating warns.'))
      .addSubcommand((s) => s.setName('show').setDescription('Show moderation settings.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'dm': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await updateModSettings(guildId, { dmOnAction: enabled });
        await reply(enabled ? "People get a DM when they're actioned." : 'No more DMs on actions.');
        return;
      }
      case 'escalate': {
        const warns = interaction.options.getInteger('warns', true);
        const action = interaction.options.getString('action', true);
        const raw = interaction.options.getString('duration');
        const duration = raw ? parseDuration(raw) : null;
        if (action === 'timeout' && duration && duration > MAX_TIMEOUT_SECONDS) throw new UserError('Timeouts max out at 28d.');
        await updateModSettings(guildId, { warnThreshold: warns, warnAction: action, warnDuration: action === 'kick' ? null : duration });
        const length = action === 'kick' ? '' : ` for ${duration ? formatDuration(duration) : action === 'timeout' ? '1h' : 'good'}`;
        await reply(`At ${warns} active warns: ${action}${length}.`);
        return;
      }
      case 'escalate-off':
        await updateModSettings(guildId, { warnThreshold: null, warnAction: null, warnDuration: null });
        await reply('Warns no longer escalate.');
        return;
      default: {
        const s = await getModSettings(guildId);
        const escalate = s.warnThreshold
          ? `${s.warnThreshold} warns → ${s.warnAction}${s.warnDuration ? ` ${formatDuration(s.warnDuration)}` : ''}`
          : 'off';
        const lines = [
          `**DM on action** ${s.dmOnAction ? 'on' : 'off'}`,
          `**Escalation** ${escalate}`,
        ];
        await interaction.reply({ embeds: [info(lines.join('\n'), 'Moderation')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const s = await getModSettings(guildId);
    return s.warnThreshold ? `escalate at ${s.warnThreshold} warns (${s.warnAction})` : 'no escalation';
  },
});
