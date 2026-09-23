import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type EmbedBuilder,
} from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { setModuleEnabled } from '../../../core/guildConfig.js';
import type { CommandContext, LoadedModule, Registry } from '../../../core/types.js';

// Built-in /config subcommands. A module with one of these names can't have a section.
const RESERVED = new Set(['view', 'modules']);

export function configCommandData(modules: LoadedModule[]) {
  const data = new SlashCommandBuilder()
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
    );
  for (const mod of modules) {
    const section = mod.config;
    if (!section) continue;
    if (RESERVED.has(mod.meta.name)) {
      throw new Error(`Module ${mod.meta.name} can't have a /config section: that name is taken`);
    }
    data.addSubcommandGroup((g) =>
      section.build(g.setName(mod.meta.name).setDescription(mod.meta.description.slice(0, 100))),
    );
  }
  return data;
}

export async function toggleModule(registry: Registry, guildId: string, name: string, enabled: boolean): Promise<void> {
  const mod = registry.modules.find((m) => m.meta.name === name);
  if (!mod) {
    const options = registry.modules.filter((m) => !m.meta.alwaysOn).map((m) => m.meta.name);
    throw new UserError(`No module called ${name}. Options: ${options.join(', ') || 'none'}.`);
  }
  if (mod.meta.alwaysOn) throw new UserError(`${name} can't be turned off.`);
  await setModuleEnabled(guildId, name, enabled);
}

export async function runConfigSection(
  ctx: CommandContext,
  guildId: string,
  group: string,
  isEnabled: (guildId: string, module: string) => Promise<boolean>,
): Promise<void> {
  const mod = ctx.registry.modules.find((m) => m.meta.name === group);
  if (!mod?.config) throw new UserError(`There are no settings called ${group}.`);
  if (!mod.meta.alwaysOn && !(await isEnabled(guildId, group))) {
    throw new UserError(`${group} is off in this server. Turn it on with /config modules enable.`);
  }
  await mod.config.run(ctx);
}

export async function sectionSummaries(
  registry: Registry,
  guildId: string,
  disabled: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  for (const mod of registry.modules) {
    if (!mod.config?.view) continue;
    if (!mod.meta.alwaysOn && disabled.has(mod.meta.name)) continue;
    summaries.set(mod.meta.name, await mod.config.view(guildId));
  }
  return summaries;
}

export function buildConfigView(
  registry: Registry,
  disabled: ReadonlySet<string>,
  summaries: ReadonlyMap<string, string> = new Map(),
): EmbedBuilder {
  const lines = registry.modules.map((m) => {
    const on = m.meta.alwaysOn || !disabled.has(m.meta.name);
    const suffix = m.meta.alwaysOn ? ' (always on)' : '';
    const summary = summaries.get(m.meta.name);
    return `${on ? '●' : '○'} **${m.meta.name}**${suffix}: ${m.meta.description}${summary ? `\n└ ${summary}` : ''}`;
  });
  return info(lines.join('\n'), 'Server config').setFooter({ text: 'Toggle with /config modules enable|disable' });
}
