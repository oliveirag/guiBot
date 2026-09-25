import { describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { catImage, dogImage, randomMeme } from '../../../src/modules/fun/lib/media.js';
import {
  parseChoices,
  parseDice,
  rollDice,
  rpsResult,
  scoreBar,
  shuffle,
  stableScore,
} from '../../../src/modules/fun/lib/random.js';
import { BOT, bestMove, decode, encode, newGame, play, render, turn, winner } from '../../../src/modules/fun/lib/tictactoe.js';
import { fetchQuestion, guess, renderRound, winnersOf } from '../../../src/modules/fun/lib/trivia.js';

const b = (s: string) => s.split('') as ('x' | 'o' | '-')[];
const fixed = (v: number) => () => v;

describe('random helpers', () => {
  it('parses and rolls dice', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('3d8 - 2')).toEqual({ count: 3, sides: 8, modifier: -2 });
    expect(parseDice('12')).toEqual({ count: 1, sides: 12, modifier: 0 });
    expect(() => parseDice('d1')).toThrow(UserError);
    expect(() => parseDice('500d6')).toThrow(UserError);
    expect(() => parseDice('banana')).toThrow(UserError);
    expect(rollDice({ count: 2, sides: 6, modifier: 1 }, fixed(0.99))).toEqual({ rolls: [6, 6], total: 13 });
  });

  it('splits choices by pipes or commas', () => {
    expect(parseChoices('pizza, tacos ,sushi')).toEqual(['pizza', 'tacos', 'sushi']);
    expect(parseChoices('a, b | c')).toEqual(['a, b', 'c']);
    expect(() => parseChoices('just one')).toThrow(UserError);
  });

  it('scores stably, ignoring order and case', () => {
    expect(stableScore('ship', 'a', 'b')).toBe(stableScore('ship', 'B', 'A'));
    const s = stableScore('rate', 'pineapple pizza');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
    expect(scoreBar(50)).toBe('█████░░░░░');
  });

  it('judges rock paper scissors', () => {
    expect(rpsResult('rock', 'scissors')).toBe('win');
    expect(rpsResult('paper', 'scissors')).toBe('lose');
    expect(rpsResult('paper', 'rock')).toBe('win');
    expect(rpsResult('rock', 'rock')).toBe('tie');
  });

  it('shuffles without losing items', () => {
    expect(shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('media', () => {
  it('reads each API and hides failures behind a friendly error', async () => {
    expect(await catImage(async () => [{ url: 'https://c/1.jpg' }])).toBe('https://c/1.jpg');
    expect(await dogImage(async () => ({ message: 'https://d/1.jpg', status: 'success' }))).toBe('https://d/1.jpg');
    await expect(catImage(async () => [])).rejects.toThrow(UserError);
    await expect(dogImage(async () => { throw new Error('down'); })).rejects.toThrow(/isn't answering/);
  });

  it('skips NSFW and spoiler memes', async () => {
    const posts = [
      { nsfw: true, spoiler: false },
      { nsfw: false, spoiler: true },
      { nsfw: false, spoiler: false },
    ].map((f, i) => ({ title: `m${i}`, url: 'https://i/1.png', postLink: 'https://r/1', subreddit: 'memes', ...f }));
    let i = 0;
    expect((await randomMeme(async () => posts[i++])).title).toBe('m2');
    await expect(randomMeme(async () => posts[0])).rejects.toThrow(/clean meme/);
  });
});

describe('tic-tac-toe', () => {
  it('finds winners, draws, and whose turn it is', () => {
    expect(winner(b('xxxoo----'))).toBe('x');
    expect(winner(b('o-xo-xo--'))).toBe('o');
    expect(winner(b('xoxxoooxx'))).toBe('draw');
    expect(winner(b('---------'))).toBeNull();
    expect(turn(b('x--------'))).toBe('o');
    expect(turn(b('xo-------'))).toBe('x');
  });

  it('bot wins when it can and blocks when it must', () => {
    expect(bestMove(b('xx-oo----'))).toBe(2); // x to move: take the win
    expect(bestMove(b('xx-o-----'))).toBe(2); // o to move: block
    expect(bestMove(b('oo-xx-x--'))).toBe(2); // o to move: win beats blocking
  });

  it('round-trips through button ids', () => {
    const g = { ...newGame('111', '222'), board: b('x-o------') };
    expect(decode(encode(g, 4))).toEqual({ game: g, cell: 4 });
    expect(decode('ttt:1:2:xxxxxxxxxxx:4')).toBeNull();
    expect(encode(newGame('123456789012345678', '876543210987654321'), 8).length).toBeLessThanOrEqual(100);
  });

  it('enforces turns and squares, and guiBot answers', () => {
    const pvp = newGame('a', 'b');
    expect(play(pvp, 0, 'b')).toEqual({ ok: false, reason: "It's not your turn." });
    expect(play(pvp, 0, 'z')).toMatchObject({ ok: false, reason: expect.stringMatching(/not in this game/) });
    const moved = play(pvp, 0, 'a');
    expect(moved.ok && moved.game.board.join('')).toBe('x--------');
    if (moved.ok) expect(play(moved.game, 0, 'b')).toEqual({ ok: false, reason: 'That square is taken.' });

    const vsBot = play(newGame('a', BOT), 4, 'a');
    expect(vsBot.ok && vsBot.game.board.filter((c) => c === 'o')).toHaveLength(1);
    expect(play({ x: 'a', o: 'b', board: b('xxxoo----') }, 5, 'b')).toEqual({ ok: false, reason: 'This game is already over.' });
  });

  it('never loses to random play', () => {
    for (let game = 0; game < 30; game++) {
      let g = newGame('a', BOT);
      while (!winner(g.board)) {
        const open = g.board.flatMap((c, i) => (c === '-' ? [i] : []));
        const r = play(g, open[Math.floor(Math.random() * open.length)]!, 'a');
        if (!r.ok) throw new Error(r.reason);
        g = r.game;
      }
      expect(winner(g.board)).not.toBe('x');
    }
  });

  it('disables everything once the game ends', () => {
    const view = render({ x: 'a', o: BOT, board: b('xxxoo----') });
    const rows = view.components!.map((r) => (r as { toJSON(): { components: { disabled?: boolean }[] } }).toJSON());
    expect(rows.flatMap((r) => r.components).every((c) => c.disabled)).toBe(true);
  });
});

describe('trivia', () => {
  const api = (over: Record<string, unknown> = {}) => async () => ({
    response_code: 0,
    results: [
      {
        category: 'Science%3A%20Computers',
        difficulty: 'easy',
        question: 'What%20does%20CPU%20stand%20for%3F',
        correct_answer: 'Central%20Processing%20Unit',
        incorrect_answers: ['Computer%20Personal%20Unit', 'Central%20Process%20Unit', 'Core%20Processing%20Unit'],
      },
    ],
    ...over,
  });

  it('decodes questions and tracks the right answer after shuffling', async () => {
    const q = await fetchQuestion({}, api());
    expect(q.text).toBe('What does CPU stand for?');
    expect(q.category).toBe('Science: Computers');
    expect(q.answers).toHaveLength(4);
    expect(q.answers[q.correct]).toBe('Central Processing Unit');
  });

  it('keeps true/false in order', async () => {
    const q = await fetchQuestion(
      {},
      api({ results: [{ category: 'x', difficulty: 'easy', question: 'q', correct_answer: 'False', incorrect_answers: ['True'] }] }),
    );
    expect(q.answers).toEqual(['True', 'False']);
    expect(q.correct).toBe(1);
  });

  it('explains rate limits and outages', async () => {
    await expect(fetchQuestion({}, api({ response_code: 5, results: [] }))).rejects.toThrow(/breather/);
    await expect(fetchQuestion({}, async () => { throw new Error('x'); })).rejects.toThrow(/isn't answering/);
  });

  it('takes one guess each and names the winners', async () => {
    const question = await fetchQuestion({}, api());
    const round = { question, guesses: new Map<string, number>() };
    expect(guess(round, 'a', question.correct)).toBe(true);
    expect(guess(round, 'a', (question.correct + 1) % 4)).toBe(false);
    expect(guess(round, 'b', (question.correct + 1) % 4)).toBe(true);
    expect(winnersOf(round)).toEqual(['a']);
    const shown = renderRound('r1', question, { winners: ['a'], guessers: 2 }).embeds[0]!.toJSON().description!;
    expect(shown).toContain('Answer: **');
    expect(shown).toContain('<@a>');
  });
});
