import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandPayload } from '../../src/core/deploy.js';
import { buildRegistry, loadModules } from '../../src/core/loader.js';
import { fakeCommand, fakeModule } from '../helpers.js';

describe('commandPayload', () => {
  it('serializes every registered command', () => {
    const registry = buildRegistry([
      fakeModule('core', [fakeCommand('ping'), fakeCommand('help')]),
      fakeModule('fun', [fakeCommand('roll')]),
    ]);
    expect(commandPayload(registry).map((c) => c.name)).toEqual(['ping', 'help', 'roll']);
  });

  it('includes /pp when every real module loads', async () => {
    const root = fileURLToPath(new URL('../../src/modules', import.meta.url));
    const names = commandPayload(buildRegistry(await loadModules(root, null))).map((c) => c.name);
    expect(names).toContain('pp');
    // Discord caps global chat commands at 100.
    expect(names.length).toBeLessThanOrEqual(100);
  });
});
