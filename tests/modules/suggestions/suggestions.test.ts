import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSuggestion,
  getSuggestion,
  renderSuggestion,
  review,
  tally,
  vote,
} from '../../../src/modules/suggestions/lib/suggestions.js';
import { resetDb } from '../../db.js';

const G = 'g1';
const make = (guildId = G) => createSuggestion({ guildId, authorId: 'a', content: 'Add a memes channel', channelId: 'c' });

type Row = { toJSON(): { components: { custom_id: string; disabled?: boolean }[] } };
type Embed = { toJSON(): { title?: string; color?: number; fields?: { name: string; value: string }[]; footer?: { text: string } } };

beforeEach(resetDb);

describe('suggestions', () => {
  it('numbers per guild', async () => {
    expect((await make()).number).toBe(1);
    expect((await make()).number).toBe(2);
    expect((await make('g2')).number).toBe(1);
    await expect(getSuggestion(G, 9)).rejects.toThrow(/no suggestion #9/);
  });

  it('votes once per person, toggling and switching', async () => {
    const s = await make();
    expect(await vote(s.id, 'u1', 1)).toBe('added');
    expect(await vote(s.id, 'u2', 1)).toBe('added');
    expect(await vote(s.id, 'u3', -1)).toBe('added');
    expect(await tally(s.id)).toEqual({ up: 2, down: 1 });
    expect(await vote(s.id, 'u1', 1)).toBe('removed');
    expect(await vote(s.id, 'u3', 1)).toBe('switched');
    expect(await tally(s.id)).toEqual({ up: 2, down: 0 });
  });

  it('renders status and votes, and closes voting on approve or deny', async () => {
    const s = await make();
    const open = renderSuggestion(s, { up: 3, down: 1 }, { name: 'Ana' });
    const embed = (open.embeds![0] as Embed).toJSON();
    expect(embed.fields).toEqual([
      { name: 'Status', value: 'Open', inline: true },
      { name: 'Votes', value: '👍 3 · 👎 1', inline: true },
    ]);
    expect(embed.footer?.text).toBe('Suggestion #1');
    const buttons = (open.components![0] as Row).toJSON().components;
    expect(buttons.map((b) => b.custom_id)).toEqual([`sg:${s.id}:up`, `sg:${s.id}:down`]);
    expect(buttons.every((b) => !b.disabled)).toBe(true);

    const considered = renderSuggestion(await review(s, 'considered', 'mod', null), { up: 0, down: 0 }, { name: 'Ana' });
    expect((considered.components![0] as Row).toJSON().components.every((b) => !b.disabled)).toBe(true);

    const approved = renderSuggestion(await review(s, 'approved', 'mod', 'Good call'), { up: 0, down: 0 }, { name: 'Ana' });
    expect((approved.embeds![0] as Embed).toJSON().fields?.at(-1)).toEqual({ name: 'Approved by', value: '<@mod>: Good call' });
    expect((approved.components![0] as Row).toJSON().components.every((b) => b.disabled)).toBe(true);
  });
});
