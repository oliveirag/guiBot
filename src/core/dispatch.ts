import type { ChatInputCommandInteraction } from 'discord.js';
import type { Env } from '../env.js';
import type { Cooldowns } from './cooldowns.js';
import { err } from './embeds.js';
import { UserError, reportError } from './errors.js';
import type { Logger } from './log.js';
import { checkAccess } from './perms.js';
import { respond } from './reply.js';
import type { Registry } from './types.js';

export interface DispatchDeps {
  registry: Registry;
  env: Env;
  cooldowns: Cooldowns;
  isModuleEnabled: (guildId: string, module: string) => Promise<boolean>;
  log: Logger;
}

export async function handleCommand(interaction: ChatInputCommandInteraction, deps: DispatchDeps): Promise<void> {
  const entry = deps.registry.commands.get(interaction.commandName);
  if (!entry) {
    await respond(interaction, err("I don't know that command anymore. It may have been removed."));
    return;
  }
  const { command, module } = entry;
  const userId = interaction.user.id;

  try {
    const guildId = interaction.inGuild() ? interaction.guildId : null;
    if (guildId && !module.alwaysOn && !(await deps.isModuleEnabled(guildId, module.name))) {
      throw new UserError(`The ${module.name} module is disabled in this server.`);
    }

    const denied = checkAccess(command, {
      userId,
      ownerIds: deps.env.ownerIds,
      inGuild: guildId !== null,
      has: (permission) => interaction.memberPermissions?.has(permission) ?? false,
    });
    if (denied) throw new UserError(denied);

    if (command.cooldownSeconds && !deps.env.ownerIds.includes(userId)) {
      const left = deps.cooldowns.hit(`${command.data.name}:${userId}`, command.cooldownSeconds);
      if (left > 0) throw new UserError(`Slow down. Try again in ${left}s.`);
    }

    await command.run({ interaction, registry: deps.registry, env: deps.env });
  } catch (error) {
    await reportError(interaction, error, deps.log);
  }
}
