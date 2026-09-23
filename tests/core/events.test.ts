import { EventEmitter } from 'node:events';
import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { bindEvents, extractGuildId } from '../../src/core/events.js';
import { buildRegistry } from '../../src/core/loader.js';
import type { EventHandler } from '../../src/core/types.js';
import { fakeModule, silentLog } from '../helpers.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('extractGuildId', () => {
  it('finds the guild id on common event args', () => {
    expect(extractGuildId([{ guildId: 'g1' }])).toBe('g1');
    expect(extractGuildId([{ guild: { id: 'g2' } }])).toBe('g2');
    expect(extractGuildId([{ message: { guildId: 'g3' } }, { id: 'user' }])).toBe('g3');
    expect(extractGuildId([{}, 'text', null])).toBeNull();
  });
});

describe('bindEvents', () => {
  function setup(enabled: boolean, alwaysOn = false) {
    const run = vi.fn();
    const handler: EventHandler = { name: 'messageCreate', run };
    const client = new EventEmitter();
    const log = silentLog();
    bindEvents(
      client as unknown as Pick<Client, 'on' | 'once'>,
      buildRegistry([fakeModule('levels', [], { alwaysOn }, [handler])]),
      { isModuleEnabled: async () => enabled, log },
    );
    return { client, run, log };
  }

  it('runs handlers for enabled modules', async () => {
    const { client, run } = setup(true);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).toHaveBeenCalledWith({ guildId: 'g1' });
  });

  it('skips handlers for modules disabled in that guild', async () => {
    const { client, run } = setup(false);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('always runs alwaysOn modules', async () => {
    const { client, run } = setup(false, true);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).toHaveBeenCalled();
  });

  it('logs handler errors instead of crashing', async () => {
    const { client, run, log } = setup(true);
    run.mockImplementation(() => {
      throw new Error('boom');
    });
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(log.error).toHaveBeenCalled();
  });
});
