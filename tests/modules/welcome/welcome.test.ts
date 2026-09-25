import { beforeEach, describe, expect, it } from 'vitest';
import { greeting, renderTemplate } from '../../../src/modules/welcome/lib/greet.js';
import { resetDb } from '../../db.js';

const G = 'g1';
const vars = { userId: 'u1', username: 'ana', server: 'Blue', count: 42 };

beforeEach(resetDb);

describe('templates', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(renderTemplate('Hi {user} ({username}) in {server}, #{count} {nope}', vars)).toBe('Hi <@u1> (ana) in Blue, #42 {nope}');
  });

  it('only pings the new member, and pings above embeds', () => {
    const plain = greeting('yo {user} @everyone', vars, false);
    expect(plain).toMatchObject({ content: 'yo <@u1> @everyone', allowedMentions: { users: ['u1'] } });
    const embed = greeting('yo {user}', vars, true, 'https://a/b.png');
    expect(embed.content).toBe('<@u1>');
    expect((embed.embeds![0] as { toJSON(): { description: string; thumbnail?: { url: string } } }).toJSON()).toMatchObject({
      description: 'yo <@u1>',
      thumbnail: { url: 'https://a/b.png' },
    });
    expect(greeting('welcome {username}', vars, true).content).toBeUndefined();
  });
});
