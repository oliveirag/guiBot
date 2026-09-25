import { Events, MessageFlags, type ButtonInteraction, type Interaction, type StringSelectMenuInteraction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { PANEL_PREFIX, selectionChanges } from '../lib/panels.js';

const mention = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(', ');

async function toggle(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const [panelId, roleId] = interaction.customId.slice(PANEL_PREFIX.length).split(':');
  const option = await prisma.rolePanelOption.findFirst({
    where: { panelId: Number(panelId), roleId, panel: { guildId: interaction.guildId } },
  });
  if (!option) throw new UserError("That role isn't on this panel anymore.");
  const member = interaction.member;
  if (member.roles.cache.has(option.roleId)) {
    await member.roles.remove(option.roleId, 'Role panel');
    await interaction.reply({ embeds: [ok(`Removed <@&${option.roleId}>.`)], flags: MessageFlags.Ephemeral });
  } else {
    await member.roles.add(option.roleId, 'Role panel');
    await interaction.reply({ embeds: [ok(`Gave you <@&${option.roleId}>.`)], flags: MessageFlags.Ephemeral });
  }
}

async function select(interaction: StringSelectMenuInteraction<'cached'>): Promise<void> {
  const panelId = Number(interaction.customId.slice(PANEL_PREFIX.length));
  const options = await prisma.rolePanelOption.findMany({ where: { panelId, panel: { guildId: interaction.guildId } } });
  const member = interaction.member;
  const { add, remove } = selectionChanges(new Set(member.roles.cache.keys()), options.map((o) => o.roleId), interaction.values);
  if (add.length > 0) await member.roles.add(add, 'Role panel');
  if (remove.length > 0) await member.roles.remove(remove, 'Role panel');
  const parts = [add.length ? `Added ${mention(add)}.` : '', remove.length ? `Removed ${mention(remove)}.` : ''].filter(Boolean);
  await interaction.reply({ embeds: [ok(parts.join(' ') || 'No changes.')], flags: MessageFlags.Ephemeral });
}

export default event({
  name: Events.InteractionCreate,
  async run(interaction: Interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith(PANEL_PREFIX)) return;
    try {
      if (interaction.isButton()) await toggle(interaction);
      else await select(interaction);
    } catch (error) {
      // Missing Permissions here means the role moved above guiBot after the panel was made.
      const code = (error as { code?: unknown }).code;
      const shown = code === 50013 ? new UserError("I can't give that role anymore. A mod needs to move my role above it.") : error;
      if (!(shown instanceof UserError)) log.error('roles: panel click failed', error);
      await reportError(interaction, shown, log);
    }
  },
});
