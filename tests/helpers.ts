import { SlashCommandBuilder, type APIEmbed, type ChatInputCommandInteraction, type EmbedBuilder } from 'discord.js';
import { vi, type Mock } from 'vitest';
import type { Env } from '../src/env.js';
import type { Command, EventHandler, LoadedModule, ModuleMeta } from '../src/core/types.js';

export interface FakeInteraction {
  commandName: string;
  user: { id: string };
  guildId: string | null;
  memberPermissions: { has: (permission: unknown) => boolean } | null;
  replied: boolean;
  deferred: boolean;
  inGuild(): boolean;
  reply: Mock;
  followUp: Mock;
  editReply: Mock;
}

export function fakeInteraction(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  const i: FakeInteraction = {
    commandName: 'ping',
    user: { id: 'u1' },
    guildId: 'g1',
    memberPermissions: { has: () => true },
    replied: false,
    deferred: false,
    inGuild: () => i.guildId !== null,
    reply: vi.fn(async () => {
      i.replied = true;
    }),
    followUp: vi.fn(async () => {}),
    editReply: vi.fn(async () => {
      i.replied = true;
    }),
    ...overrides,
  };
  return i;
}

export const asInteraction = (i: FakeInteraction): ChatInputCommandInteraction =>
  i as unknown as ChatInputCommandInteraction;

export function lastEmbed(mock: Mock): APIEmbed {
  const payload = mock.mock.calls.at(-1)?.[0] as { embeds: EmbedBuilder[] };
  return payload.embeds[0]!.toJSON();
}

export function fakeCommand(name: string, extra: Partial<Command> = {}): Command {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} command`),
    run: vi.fn(async () => {}),
    ...extra,
  };
}

export function fakeModule(
  name: string,
  commands: Command[] = [],
  meta: Partial<ModuleMeta> = {},
  events: EventHandler[] = [],
): LoadedModule {
  return { meta: { name, description: `${name} module`, ...meta }, commands, events, jobs: [] };
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    discordToken: 'token',
    clientId: 'client',
    databaseUrl: 'file:./test.db',
    port: 0,
    enabledModules: null,
    ownerIds: ['owner'],
    isProduction: false,
    ...overrides,
  };
}

export function silentLog(): { info: Mock; warn: Mock; error: Mock } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
