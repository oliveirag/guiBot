import type { Client } from 'discord.js';
import { Guild } from 'discord.js';
import type { Logger } from './log.js';
import type { Registry } from './types.js';

interface MaybeGuildScoped {
  guildId?: unknown;
  guild?: { id?: unknown } | null;
  message?: { guildId?: unknown } | null;
}

/** Best-effort guild lookup across discord.js event args (messages, members, reactions, states). */
export function extractGuildId(args: readonly unknown[]): string | null {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    if (arg instanceof Guild) return arg.id;
    const a = arg as MaybeGuildScoped;
    if (typeof a.guildId === 'string') return a.guildId;
    if (a.guild && typeof a.guild.id === 'string') return a.guild.id;
    if (a.message && typeof a.message.guildId === 'string') return a.message.guildId;
  }
  return null;
}

export function bindEvents(
  client: Pick<Client, 'on' | 'once'>,
  registry: Registry,
  deps: { isModuleEnabled: (guildId: string, module: string) => Promise<boolean>; log: Logger },
): void {
  for (const mod of registry.modules) {
    for (const handler of mod.events) {
      const listener = async (...args: unknown[]): Promise<void> => {
        try {
          const guildId = extractGuildId(args);
          if (guildId && !mod.meta.alwaysOn && !(await deps.isModuleEnabled(guildId, mod.meta.name))) return;
          await (handler.run as (...a: unknown[]) => unknown)(...args);
        } catch (error) {
          deps.log.error(`event ${handler.name} in ${mod.meta.name} failed`, error);
        }
      };
      if (handler.once) client.once(handler.name, listener);
      else client.on(handler.name, listener);
    }
  }
}
