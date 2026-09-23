import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { getDisabledModules, isModuleEnabled } from '../../../core/guildConfig.js';
import {
  buildConfigView,
  configCommandData,
  runConfigSection,
  sectionSummaries,
  toggleModule,
} from '../lib/config.js';

export default command({
  data: configCommandData([]),
  dataFor: configCommandData,
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,
  async run(ctx) {
    const { interaction, registry } = ctx;
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'modules') {
      const name = interaction.options.getString('module', true).trim().toLowerCase();
      const enabled = interaction.options.getSubcommand() === 'enable';
      await toggleModule(registry, guildId, name, enabled);
      await interaction.reply({
        embeds: [ok(`${name} is now ${enabled ? 'on' : 'off'} in this server.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group) {
      await runConfigSection(ctx, guildId, group, isModuleEnabled);
      return;
    }

    const disabled = await getDisabledModules(guildId);
    const view = buildConfigView(registry, disabled, await sectionSummaries(registry, guildId, disabled));
    await interaction.reply({ embeds: [view], flags: MessageFlags.Ephemeral });
  },
});
