import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  PermissionResolvable,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';
import type { Logger } from './log.js';

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
  /** Builds slash data from every loaded module. Resolved once by buildRegistry, replacing `data`. */
  dataFor?(modules: LoadedModule[]): CommandData;
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

/** A module's `/config <module>` subcommand group. Lives in `src/modules/<name>/config.ts`. */
export interface ConfigSection {
  build(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder;
  run(ctx: CommandContext): Promise<void>;
  /** One short line for /config view, like "2 feeds". */
  view?(guildId: string): Promise<string>;
}

export interface HttpDeps {
  env: Env;
  log: Logger;
}

/** A module's HTTP routes. Lives in `src/modules/<name>/routes/`, one Fastify scope per file. */
export type HttpRoutes = (app: FastifyInstance, deps: HttpDeps) => Promise<void>;

export interface LoadedModule {
  meta: ModuleMeta;
  commands: Command[];
  events: EventHandler[];
  jobs: JobHandler[];
  config: ConfigSection | null;
  routes: HttpRoutes[];
}

export interface Registry {
  modules: LoadedModule[];
  commands: Map<string, { command: Command; module: ModuleMeta }>;
}
