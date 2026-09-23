import { fileURLToPath } from 'node:url';
import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildRegistry, loadModules } from '../../src/core/loader.js';
import { fakeCommand, fakeModule } from '../helpers.js';

const root = fileURLToPath(new URL('../fixtures/modules', import.meta.url));

describe('loadModules', () => {
  it('loads every module folder that has an index', async () => {
    const modules = await loadModules(root, null);
    expect(modules.map((m) => m.meta.name)).toEqual(['alpha', 'beta']);
    const beta = modules[1]!;
    expect(beta.commands.map((c) => c.data.name)).toEqual(['two']);
    expect(beta.events.map((e) => e.name)).toEqual(['messageCreate']);
    expect(beta.jobs.map((j) => j.type)).toEqual(['beta.tick']);
    expect(modules[0]!.config).toBeNull();
    expect(beta.config?.build).toBeTypeOf('function');
    expect(beta.routes).toHaveLength(1);
    expect(modules[0]!.routes).toEqual([]);
  });

  it('only loads enabled modules but always keeps alwaysOn ones', async () => {
    const modules = await loadModules(root, ['something-else']);
    expect(modules.map((m) => m.meta.name)).toEqual(['alpha']);
  });
});

describe('buildRegistry', () => {
  it('maps command names to their command and module', () => {
    const ping = fakeCommand('ping');
    const registry = buildRegistry([fakeModule('core', [ping])]);
    expect(registry.commands.get('ping')).toEqual({ command: ping, module: expect.objectContaining({ name: 'core' }) });
  });

  it('rejects duplicate command names across modules', () => {
    expect(() => buildRegistry([fakeModule('a', [fakeCommand('ping')]), fakeModule('b', [fakeCommand('ping')])])).toThrow(
      /Duplicate command \/ping in a and b/,
    );
  });

  it('lets a command build its data from every loaded module', () => {
    const config = fakeCommand('config', {
      dataFor: (mods) =>
        new SlashCommandBuilder().setName('config').setDescription(mods.map((m) => m.meta.name).join(',')),
    });
    const registry = buildRegistry([fakeModule('core', [config]), fakeModule('dev')]);
    expect(registry.commands.get('config')!.command.data.toJSON().description).toBe('core,dev');
  });
});
