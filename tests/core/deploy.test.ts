import { describe, expect, it } from 'vitest';
import { commandPayload } from '../../src/core/deploy.js';
import { buildRegistry } from '../../src/core/loader.js';
import { fakeCommand, fakeModule } from '../helpers.js';

describe('commandPayload', () => {
  it('serializes every registered command', () => {
    const registry = buildRegistry([
      fakeModule('core', [fakeCommand('ping'), fakeCommand('help')]),
      fakeModule('fun', [fakeCommand('roll')]),
    ]);
    expect(commandPayload(registry).map((c) => c.name)).toEqual(['ping', 'help', 'roll']);
  });
});
