import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { setModuleEnabled } from '../../../core/guildConfig.js';
import type { Registry } from '../../../core/types.js';

export async function toggleModule(registry: Registry, guildId: string, name: string, enabled: boolean): Promise<void> {
  const mod = registry.modules.find((m) => m.meta.name === name);
  if (!mod) {
    const options = registry.modules.filter((m) => !m.meta.alwaysOn).map((m) => m.meta.name);
    throw new UserError(`No module called ${name}. Options: ${options.join(', ') || 'none'}.`);
  }
  if (mod.meta.alwaysOn) throw new UserError(`${name} can't be turned off.`);
  await setModuleEnabled(guildId, name, enabled);
}

export function buildConfigView(registry: Registry, disabled: ReadonlySet<string>): EmbedBuilder {
  const lines = registry.modules.map((m) => {
    const on = m.meta.alwaysOn || !disabled.has(m.meta.name);
    const suffix = m.meta.alwaysOn ? ' (always on)' : '';
    return `${on ? '●' : '○'} **${m.meta.name}**${suffix}: ${m.meta.description}`;
  });
  return info(lines.join('\n'), 'Server config').setFooter({ text: 'Toggle with /config modules enable|disable' });
}
