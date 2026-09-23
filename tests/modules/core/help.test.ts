import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { buildRegistry } from '../../../src/core/loader.js';
import { buildHelp } from '../../../src/modules/core/lib/help.js';
import { fakeCommand, fakeModule } from '../../helpers.js';

const roll = fakeCommand('roll', {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice')
    .addIntegerOption((o) => o.setName('sides').setDescription('Number of sides')),
});

const registry = buildRegistry([
  fakeModule('core', [fakeCommand('ping'), fakeCommand('help')], { alwaysOn: true }),
  fakeModule('fun', [roll]),
  fakeModule('empty'),
]);

describe('buildHelp', () => {
  it('lists modules that have commands', () => {
    const fields = buildHelp(registry, new Set()).toJSON().fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['core', 'fun']);
    expect(fields[0]!.value).toContain('/ping');
  });

  it('hides modules disabled in the guild', () => {
    const fields = buildHelp(registry, new Set(['fun'])).toJSON().fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['core']);
  });

  it('shows one command in detail', () => {
    const json = buildHelp(registry, new Set(), '/roll').toJSON();
    expect(json.title).toBe('/roll');
    expect(json.description).toContain('Roll dice');
    expect(json.description).toContain('`sides` Number of sides');
  });

  it('rejects unknown commands', () => {
    expect(() => buildHelp(registry, new Set(), 'nope')).toThrow(UserError);
  });
});
