import { fileURLToPath } from 'node:url';
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
});
