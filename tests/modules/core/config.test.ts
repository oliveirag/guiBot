import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { configSection } from '../../../src/core/define.js';
import { UserError } from '../../../src/core/errors.js';
import { isModuleEnabled, setModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildRegistry } from '../../../src/core/loader.js';
import type { CommandContext, LoadedModule, Registry } from '../../../src/core/types.js';
import {
  buildConfigView,
  configCommandData,
  runConfigSection,
  sectionSummaries,
  toggleModule,
} from '../../../src/modules/core/lib/config.js';
import { resetDb } from '../../db.js';
import { asInteraction, fakeInteraction, fakeModule, testEnv } from '../../helpers.js';

const registry = buildRegistry([fakeModule('core', [], { alwaysOn: true }), fakeModule('fun')]);

function withSection(name: string, run = vi.fn(async () => {})): LoadedModule {
  return {
    ...fakeModule(name),
    config: configSection({
      build: (g: SlashCommandSubcommandGroupBuilder) => g.addSubcommand((s) => s.setName('list').setDescription('List.')),
      run,
      view: async () => '2 feeds',
    }),
  };
}

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

describe('configCommandData', () => {
  it('adds a subcommand group per module with a config section', () => {
    const json = configCommandData([fakeModule('core'), withSection('dev')]).toJSON();
    expect(json.options?.map((o) => o.name)).toEqual(['view', 'modules', 'dev']);
  });

  it('refuses a module whose name collides with a built-in subcommand', () => {
    expect(() => configCommandData([withSection('modules')])).toThrow(/name is taken/);
  });
});

describe('runConfigSection', () => {
  beforeEach(resetDb);

  const ctxFor = (reg: Registry): CommandContext => ({
    interaction: asInteraction(fakeInteraction()),
    registry: reg,
    env: testEnv(),
  });

  it('runs the matching section', async () => {
    const run = vi.fn(async () => {});
    const ctx = ctxFor(buildRegistry([withSection('dev', run)]));
    await runConfigSection(ctx, 'g1', 'dev', isModuleEnabled);
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('refuses when the module is off in this guild', async () => {
    const run = vi.fn(async () => {});
    const ctx = ctxFor(buildRegistry([withSection('dev', run)]));
    await setModuleEnabled('g1', 'dev', false);
    await expect(runConfigSection(ctx, 'g1', 'dev', isModuleEnabled)).rejects.toThrow(/dev is off in this server/);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects groups with no section', async () => {
    await expect(runConfigSection(ctxFor(registry), 'g1', 'fun', isModuleEnabled)).rejects.toBeInstanceOf(UserError);
  });
});

describe('buildConfigView', () => {
  it('marks each module on or off', () => {
    const description = buildConfigView(registry, new Set(['fun'])).toJSON().description ?? '';
    expect(description).toContain('● **core** (always on)');
    expect(description).toContain('○ **fun**');
  });

  it('shows section summaries for enabled modules only', async () => {
    const reg = buildRegistry([withSection('dev'), withSection('sd')]);
    const summaries = await sectionSummaries(reg, 'g1', new Set(['sd']));
    expect([...summaries.keys()]).toEqual(['dev']);
    const description = buildConfigView(reg, new Set(['sd']), summaries).toJSON().description ?? '';
    expect(description).toContain('**dev**: dev module\n└ 2 feeds');
  });
});
