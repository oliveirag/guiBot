import type { GuildMember } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { prisma } from '../../../src/db.js';
import { parseEmoji, reactionKey, roleProblem } from '../../../src/modules/roles/lib/assignable.js';
import { giveAutoRoles } from '../../../src/modules/roles/lib/autoroles.js';
import { addOption, buttonChanges, createPanel, getPanel, removeOption, renderPanel, selectionChanges } from '../../../src/modules/roles/lib/panels.js';
import { applyReaction, parseMessageLink } from '../../../src/modules/roles/lib/reactions.js';
import { resetDb } from '../../db.js';

const G = 'g1';

beforeEach(resetDb);

describe('roleProblem', () => {
  const role = { id: 'r', position: 3, managed: false };

  it('allows roles below both the bot and the actor', () => {
    expect(roleProblem(role, G, 10, 5)).toBeNull();
    expect(roleProblem(role, G, 10, null)).toBeNull();
  });

  it('blocks @everyone, managed roles, and roles too high', () => {
    expect(roleProblem({ ...role, id: G }, G, 10, 5)).toMatch(/@everyone/);
    expect(roleProblem({ ...role, managed: true }, G, 10, 5)).toMatch(/bot or integration/);
    expect(roleProblem(role, G, 3, 5)).toMatch(/above mine/);
    expect(roleProblem(role, G, 10, 3)).toMatch(/above your/);
  });
});

describe('emoji and links', () => {
  it('stores custom emoji by id and unicode as is', () => {
    expect(parseEmoji('<:blue:123>')).toEqual({ key: '123', display: '<:blue:123>' });
    expect(parseEmoji('<a:spin:456>').key).toBe('456');
    expect(parseEmoji(' 🔵 ').key).toBe('🔵');
    expect(() => parseEmoji('blue')).toThrow(UserError);
    expect(reactionKey({ id: '123', name: 'blue' })).toBe('123');
    expect(reactionKey({ id: null, name: '🔵' })).toBe('🔵');
  });

  it('parses message links', () => {
    expect(parseMessageLink('https://discord.com/channels/1/2/3')).toEqual({ guildId: '1', channelId: '2', messageId: '3' });
    expect(parseMessageLink('https://ptb.discordapp.com/channels/1/2/3')?.messageId).toBe('3');
    expect(parseMessageLink('nope')).toBeNull();
  });
});

describe('panels', () => {
  it('adds, updates, removes, and renders buttons in rows of five', async () => {
    const panel = await createPanel({ guildId: G, channelId: 'c', title: 'Pick', description: null, style: 'buttons', exclusive: false });
    expect(renderPanel(panel).components).toEqual([]);
    let current = panel;
    for (let i = 0; i < 6; i++) current = await addOption(current, `r${i}`, `Role ${i}`, i === 0 ? '🔵' : null);
    current = await addOption(current, 'r0', 'Renamed', '123');
    expect(current.options.map((o) => o.label)).toEqual(['Renamed', 'Role 1', 'Role 2', 'Role 3', 'Role 4', 'Role 5']);
    const view = renderPanel(current);
    expect(view.components).toHaveLength(2);
    const first = (view.components![0] as { toJSON(): { components: { custom_id: string; emoji?: unknown }[] } }).toJSON().components[0]!;
    expect(first.custom_id).toBe(`rp:${panel.id}:r0`);
    expect(first.emoji).toEqual({ id: '123' });
    current = await removeOption(current, 'r3');
    expect(current.options).toHaveLength(5);
    await expect(removeOption(current, 'r3')).rejects.toThrow(/isn't on this panel/);
    await expect(getPanel('other', panel.id)).rejects.toThrow(/no role panel/);
  });

  it('renders a dropdown for select panels', async () => {
    const panel = await addOption(
      await createPanel({ guildId: G, channelId: 'c', title: 'Pick', description: 'd', style: 'select', exclusive: false }),
      'r1',
      'One',
      null,
    );
    const row = (renderPanel(panel).components![0] as { toJSON(): { components: { custom_id: string; max_values: number }[] } }).toJSON();
    expect(row.components[0]).toMatchObject({ custom_id: `rp:${panel.id}`, max_values: 1 });
  });

  it('works out select changes, ignoring roles not on the panel', () => {
    expect(selectionChanges(new Set(['a', 'x']), ['a', 'b', 'c'], ['b', 'zzz'])).toEqual({ add: ['b'], remove: ['a'] });
  });

  it('swaps roles on one-only panels', async () => {
    expect(buttonChanges(new Set(['a', 'x']), ['a', 'b'], 'b', true)).toEqual({ add: ['b'], remove: ['a'] });
    expect(buttonChanges(new Set(['a', 'x']), ['a', 'b'], 'b', false)).toEqual({ add: ['b'], remove: [] });
    expect(buttonChanges(new Set(['a']), ['a', 'b'], 'a', true)).toEqual({ add: [], remove: ['a'] });
    const panel = await addOption(
      await addOption(await createPanel({ guildId: G, channelId: 'c', title: 'Colors', description: null, style: 'select', exclusive: true }), 'r1', 'Red', null),
      'r2',
      'Blue',
      null,
    );
    const row = (renderPanel(panel).components![0] as { toJSON(): { components: { max_values: number }[] } }).toJSON();
    expect(row.components[0]!.max_values).toBe(1);
  });
});

describe('autoroles', () => {
  const member = (bot: boolean, pending = false, has: string[] = []) => {
    const add = vi.fn(async () => {});
    return {
      m: { pending, user: { bot }, guild: { id: G }, roles: { cache: new Map(has.map((r) => [r, {}])), add } } as unknown as GuildMember,
      add,
    };
  };

  it('gives people and bots their own roles, skipping ones they have and pending members', async () => {
    await prisma.autoRole.createMany({
      data: [
        { guildId: G, roleId: 'member', target: 'humans' },
        { guildId: G, roleId: 'extra', target: 'humans' },
        { guildId: G, roleId: 'bot', target: 'bots' },
      ],
    });
    const human = member(false, false, ['extra']);
    await giveAutoRoles(human.m);
    expect(human.add).toHaveBeenCalledWith(['member'], 'Autorole');
    const bot = member(true);
    await giveAutoRoles(bot.m);
    expect(bot.add).toHaveBeenCalledWith(['bot'], 'Autorole');
    const pending = member(false, true);
    await giveAutoRoles(pending.m);
    expect(pending.add).not.toHaveBeenCalled();
  });
});

describe('reaction roles', () => {
  it('adds and removes the mapped role, ignoring bots and unmapped emoji', async () => {
    await prisma.reactionRole.create({ data: { guildId: G, channelId: 'c', messageId: 'm', emoji: '🔵', roleId: 'blue' } });
    const add = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => ({ roles: { add, remove } }) } }) } };
    const reaction = (name: string) => ({ emoji: { id: null, name }, message: { id: 'm', guildId: G }, client }) as never;

    await applyReaction(reaction('🔵'), { bot: false, id: 'u' } as never, true);
    await applyReaction(reaction('🔵'), { bot: false, id: 'u' } as never, false);
    await applyReaction(reaction('🔴'), { bot: false, id: 'u' } as never, true);
    await applyReaction(reaction('🔵'), { bot: true, id: 'b' } as never, true);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
