import type { RolePanel, RolePanelOption } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIMessageComponentEmoji,
  type MessageCreateOptions,
} from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';

export const PANEL_PREFIX = 'rp:';
export const MAX_OPTIONS = 25;
export const MAX_PANELS = 25;

export type PanelWithOptions = RolePanel & { options: RolePanelOption[] };

const emojiOf = (key: string | null): APIMessageComponentEmoji | undefined =>
  !key ? undefined : /^\d+$/.test(key) ? { id: key } : { name: key };

export async function getPanel(guildId: string, id: number): Promise<PanelWithOptions> {
  const panel = await prisma.rolePanel.findFirst({
    where: { id, guildId },
    include: { options: { orderBy: { position: 'asc' } } },
  });
  if (!panel) throw new UserError(`There's no role panel #${id}.`);
  return panel;
}

export async function createPanel(input: {
  guildId: string;
  channelId: string;
  title: string;
  description: string | null;
  style: 'buttons' | 'select';
  exclusive: boolean;
}): Promise<PanelWithOptions> {
  if ((await prisma.rolePanel.count({ where: { guildId: input.guildId } })) >= MAX_PANELS) {
    throw new UserError(`This server already has ${MAX_PANELS} role panels.`);
  }
  return prisma.rolePanel.create({ data: input, include: { options: true } });
}

export async function addOption(panel: PanelWithOptions, roleId: string, label: string, emoji: string | null): Promise<PanelWithOptions> {
  const exists = panel.options.some((o) => o.roleId === roleId);
  if (!exists && panel.options.length >= MAX_OPTIONS) throw new UserError(`A panel holds at most ${MAX_OPTIONS} roles.`);
  const position = exists ? undefined : panel.options.length;
  await prisma.rolePanelOption.upsert({
    where: { panelId_roleId: { panelId: panel.id, roleId } },
    create: { panelId: panel.id, roleId, label, emoji, position: position ?? 0 },
    update: { label, emoji },
  });
  return getPanel(panel.guildId, panel.id);
}

export async function removeOption(panel: PanelWithOptions, roleId: string): Promise<PanelWithOptions> {
  const { count } = await prisma.rolePanelOption.deleteMany({ where: { panelId: panel.id, roleId } });
  if (count === 0) throw new UserError("That role isn't on this panel.");
  return getPanel(panel.guildId, panel.id);
}

export function renderPanel(panel: PanelWithOptions): Pick<MessageCreateOptions, 'embeds' | 'components'> {
  const fallback = panel.exclusive
    ? panel.style === 'select' ? 'Pick one role below.' : 'Click a role. You can only have one.'
    : panel.style === 'select' ? 'Pick your roles below.' : 'Click to toggle a role.';
  const lines = [panel.description ?? fallback];
  if (panel.options.length === 0) lines.push('', '*No roles yet. Add some with `/rolepanel add`.*');
  const embed = info(lines.join('\n'), panel.title).setFooter({ text: `Panel #${panel.id}${panel.exclusive ? ' · one role only' : ''}` });
  if (panel.options.length === 0) return { embeds: [embed], components: [] };

  if (panel.style === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${PANEL_PREFIX}${panel.id}`)
      .setPlaceholder(panel.exclusive ? 'Pick a role' : 'Pick roles')
      .setMinValues(0)
      .setMaxValues(panel.exclusive ? 1 : panel.options.length)
      .addOptions(
        panel.options.map((o) => ({ label: o.label.slice(0, 100), value: o.roleId, emoji: emojiOf(o.emoji) })),
      );
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  panel.options.forEach((o, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder<ButtonBuilder>());
    const button = new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}${panel.id}:${o.roleId}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(o.label.slice(0, 80));
    const emoji = emojiOf(o.emoji);
    if (emoji) button.setEmoji(emoji);
    rows.at(-1)!.addComponents(button);
  });
  return { embeds: [embed], components: rows };
}

/** For a select panel: which panel roles to add and remove so the member ends up with exactly `picked`. */
export function selectionChanges(has: ReadonlySet<string>, panelRoles: readonly string[], picked: readonly string[]) {
  const want = new Set(picked.filter((r) => panelRoles.includes(r)));
  return {
    add: [...want].filter((r) => !has.has(r)),
    remove: panelRoles.filter((r) => has.has(r) && !want.has(r)),
  };
}

/** For a button click: toggles the role, and on exclusive panels takes the member's other panel roles away. */
export function buttonChanges(has: ReadonlySet<string>, panelRoles: readonly string[], clicked: string, exclusive: boolean) {
  if (has.has(clicked)) return { add: [] as string[], remove: [clicked] };
  return { add: [clicked], remove: exclusive ? panelRoles.filter((r) => r !== clicked && has.has(r)) : [] };
}
