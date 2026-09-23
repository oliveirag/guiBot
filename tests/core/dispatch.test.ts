import { describe, expect, it, vi } from 'vitest';
import { Cooldowns } from '../../src/core/cooldowns.js';
import { handleCommand, type DispatchDeps } from '../../src/core/dispatch.js';
import { UserError } from '../../src/core/errors.js';
import { buildRegistry } from '../../src/core/loader.js';
import type { Command } from '../../src/core/types.js';
import { asInteraction, fakeCommand, fakeInteraction, fakeModule, lastEmbed, silentLog, testEnv } from '../helpers.js';

function setup(cmd: Command, meta: { alwaysOn?: boolean } = {}, enabled = true) {
  const registry = buildRegistry([fakeModule('fun', [cmd], meta)]);
  const deps: DispatchDeps = {
    registry,
    env: testEnv(),
    cooldowns: new Cooldowns(() => 0),
    isModuleEnabled: vi.fn(async () => enabled),
    log: silentLog(),
  };
  return { deps };
}

describe('handleCommand', () => {
  it('runs the command with context', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).toHaveBeenCalledWith({ interaction: i, registry: deps.registry, env: deps.env });
  });

  it('answers unknown commands', async () => {
    const { deps } = setup(fakeCommand('ping'));
    const i = fakeInteraction({ commandName: 'gone' });
    await handleCommand(asInteraction(i), deps);
    expect(lastEmbed(i.reply).description).toMatch(/don't know that command/);
  });

  it('blocks commands from modules disabled in the guild', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd, {}, false);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).not.toHaveBeenCalled();
    expect(lastEmbed(i.reply).description).toMatch(/fun module is disabled/);
  });

  it('ignores toggles for alwaysOn modules', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd, { alwaysOn: true }, false);
    await handleCommand(asInteraction(fakeInteraction()), deps);
    expect(cmd.run).toHaveBeenCalled();
  });

  it('enforces access rules', async () => {
    const cmd = fakeCommand('ping', { ownerOnly: true });
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).not.toHaveBeenCalled();
    expect(lastEmbed(i.reply).description).toMatch(/owner/);
  });

  it('applies cooldowns to everyone but owners', async () => {
    const cmd = fakeCommand('ping', { cooldownSeconds: 10 });
    const { deps } = setup(cmd);
    await handleCommand(asInteraction(fakeInteraction()), deps);
    const second = fakeInteraction();
    await handleCommand(asInteraction(second), deps);
    expect(cmd.run).toHaveBeenCalledTimes(1);
    expect(lastEmbed(second.reply).description).toMatch(/Try again in 10s/);

    await handleCommand(asInteraction(fakeInteraction({ user: { id: 'owner' } })), deps);
    await handleCommand(asInteraction(fakeInteraction({ user: { id: 'owner' } })), deps);
    expect(cmd.run).toHaveBeenCalledTimes(3);
  });

  it('reports errors thrown by the command', async () => {
    const cmd = fakeCommand('ping', {
      run: async () => {
        throw new UserError('Nope.');
      },
    });
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(lastEmbed(i.reply).description).toContain('Nope.');
  });
});
