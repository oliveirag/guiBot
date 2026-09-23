import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import type { Registry } from '../../../core/types.js';

export function buildHelp(registry: Registry, disabled: ReadonlySet<string>, commandName?: string | null): EmbedBuilder {
  if (commandName) {
    const name = commandName.replace(/^\//, '').toLowerCase();
    const entry = registry.commands.get(name);
    if (!entry) throw new UserError(`No command called /${name}.`);
    const json = entry.command.data.toJSON();
    const options = (json.options ?? []).map((o) => `\`${o.name}\` ${o.description}`);
    return info([json.description, ...options].join('\n'), `/${json.name}`).setFooter({ text: `Module: ${entry.module.name}` });
  }

  const embed = info('Run `/help command:<name>` for details on one command.', 'guiBot commands');
  for (const mod of registry.modules) {
    if (mod.commands.length === 0) continue;
    if (!mod.meta.alwaysOn && disabled.has(mod.meta.name)) continue;
    embed.addFields({ name: mod.meta.name, value: mod.commands.map((c) => `/${c.data.name}`).join(' ') });
  }
  return embed;
}
