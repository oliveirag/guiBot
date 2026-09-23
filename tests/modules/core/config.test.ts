import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { isModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildRegistry } from '../../../src/core/loader.js';
import { buildConfigView, toggleModule } from '../../../src/modules/core/lib/config.js';
import { resetDb } from '../../db.js';
import { fakeModule } from '../../helpers.js';

const registry = buildRegistry([fakeModule('core', [], { alwaysOn: true }), fakeModule('fun')]);

describe('toggleModule', () => {
  beforeEach(resetDb);

  it('disables and enables a module', async () => {
    await toggleModule(registry, 'g1', 'fun', false);
    expect(await isModuleEnabled('g1', 'fun')).toBe(false);
    await toggleModule(registry, 'g1', 'fun', true);
    expect(await isModuleEnabled('g1', 'fun')).toBe(true);
  });

  it('rejects unknown modules and lists options', async () => {
    await expect(toggleModule(registry, 'g1', 'nope', false)).rejects.toThrow(/No module called nope. Options: fun/);
  });

  it('refuses to disable alwaysOn modules', async () => {
    await expect(toggleModule(registry, 'g1', 'core', false)).rejects.toBeInstanceOf(UserError);
  });
});

describe('buildConfigView', () => {
  it('marks each module on or off', () => {
    const description = buildConfigView(registry, new Set(['fun'])).toJSON().description ?? '';
    expect(description).toContain('● **core** (always on)');
    expect(description).toContain('○ **fun**');
  });
});
