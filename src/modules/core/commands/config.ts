import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { getDisabledModules } from '../../../core/guildConfig.js';
import { buildConfigView, toggleModule } from '../lib/config.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or change guiBot settings for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('view').setDescription('Show current settings.'))
    .addSubcommandGroup((g) =>
      g
        .setName('modules')
        .setDescription('Turn modules on or off.')
        .addSubcommand((s) =>
          s
            .setName('enable')
            .setDescription('Turn a module on.')
            .addStringOption((o) => o.setName('module').setDescription('Module name').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('disable')
            .setDescription('Turn a module off.')
            .addStringOption((o) => o.setName('module').setDescription('Module name').setRequired(true)),
        ),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,
  async run({ interaction, registry }) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;

    if (interaction.options.getSubcommandGroup(false) === 'modules') {
      const name = interaction.options.getString('module', true).trim().toLowerCase();
      const enabled = interaction.options.getSubcommand() === 'enable';
      await toggleModule(registry, guildId, name, enabled);
      await interaction.reply({
        embeds: [ok(`${name} is now ${enabled ? 'on' : 'off'} in this server.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const view = buildConfigView(registry, await getDisabledModules(guildId));
    await interaction.reply({ embeds: [view], flags: MessageFlags.Ephemeral });
  },
});
