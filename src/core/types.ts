import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  PermissionResolvable,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Env } from '../env.js';

// Matches SlashCommandBuilder and its subcommand/option builder variants.
export interface CommandData {
  name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface AccessRules {
  ownerOnly?: boolean;
  guildOnly?: boolean;
  memberPermissions?: PermissionResolvable;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  registry: Registry;
  env: Env;
}

export interface Command extends AccessRules {
  data: CommandData;
  cooldownSeconds?: number;
  run(ctx: CommandContext): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  run(...args: ClientEvents[K]): unknown;
}

export interface JobContext {
  id: number;
  guildId: string | null;
  client: Client;
}

export interface JobHandler {
  type: string;
  run(payload: unknown, job: JobContext): Promise<void>;
}

export interface ModuleMeta {
  name: string;
  description: string;
  alwaysOn?: boolean;
}

export interface LoadedModule {
  meta: ModuleMeta;
  commands: Command[];
  events: EventHandler[];
  jobs: JobHandler[];
}

export interface Registry {
  modules: LoadedModule[];
  commands: Map<string, { command: Command; module: ModuleMeta }>;
}
