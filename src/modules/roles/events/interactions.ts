import { Events, MessageFlags, type ButtonInteraction, type Interaction, type StringSelectMenuInteraction } from 'discord.js';
import { event } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError, reportError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { PANEL_PREFIX, buttonChanges, selectionChanges } from '../lib/panels.js';

const mention = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(', ');

async function toggle(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const [panelId, roleId] = interaction.customId.slice(PANEL_PREFIX.length).split(':');
  const panel = await prisma.rolePanel.findFirst({
    where: { id: Number(panelId), guildId: interaction.guildId },
    include: { options: true },
  });
  const panelRoles = panel?.options.map((o) => o.roleId) ?? [];
  if (!panel || !roleId || !panelRoles.includes(roleId)) throw new UserError("That role isn't on this panel anymore.");
  const member = interaction.member;
  const { add, remove } = buttonChanges(new Set(member.roles.cache.keys()), panelRoles, roleId, panel.exclusive);
  if (remove.length > 0) await member.roles.remove(remove, 'Role panel');
  if (add.length > 0) await member.roles.add(add, 'Role panel');
  const parts = [add.length ? `Gave you ${mention(add)}.` : '', remove.length ? `Removed ${mention(remove)}.` : ''].filter(Boolean);
  await interaction.reply({ embeds: [ok(parts.join(' '))], flags: MessageFlags.Ephemeral });
}

async function select(interaction: StringSelectMenuInteraction<'cached'>): Promise<void> {
  const panelId = Number(interaction.customId.slice(PANEL_PREFIX.length));
  const panel = await prisma.rolePanel.findFirst({ where: { id: panelId, guildId: interaction.guildId }, include: { options: true } });
  if (!panel) throw new UserError("This panel doesn't exist anymore.");
  const member = interaction.member;
  // Menus posted before a panel went one-only can still send several picks.
  const picked = panel.exclusive ? interaction.values.slice(0, 1) : interaction.values;
  const { add, remove } = selectionChanges(new Set(member.roles.cache.keys()), panel.options.map((o) => o.roleId), picked);
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
