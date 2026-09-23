import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Env } from '../env.js';
import type { Registry } from './types.js';

export function commandPayload(registry: Registry): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [...registry.commands.values()].map(({ command }) => command.data.toJSON());
}

/** Guild-scoped (instant) in dev when DEV_GUILD_ID is set, global otherwise. */
export async function deployCommands(env: Env, registry: Registry): Promise<{ count: number; scope: string }> {
  const body = commandPayload(registry);
  const rest = new REST().setToken(env.discordToken);
  const guildId = env.isProduction ? undefined : env.devGuildId;
  const route = guildId
    ? Routes.applicationGuildCommands(env.clientId, guildId)
    : Routes.applicationCommands(env.clientId);
  await rest.put(route, { body });
  return { count: body.length, scope: guildId ? `guild ${guildId}` : 'global' };
}
