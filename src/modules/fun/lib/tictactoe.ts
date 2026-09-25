import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type InteractionUpdateOptions } from 'discord.js';
import { info } from '../../../core/embeds.js';

export const TTT_PREFIX = 'ttt:';
export const BOT = 'bot';

type Cell = 'x' | 'o' | '-';

/** The whole game lives in the button ids, so it survives restarts. `o` is BOT when playing guiBot. */
export interface Game {
  x: string;
  o: string;
  board: Cell[];
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export const newGame = (x: string, o: string): Game => ({ x, o, board: Array<Cell>(9).fill('-') });

export const turn = (board: readonly Cell[]): 'x' | 'o' =>
  board.filter((c) => c === 'x').length > board.filter((c) => c === 'o').length ? 'o' : 'x';

export function winner(board: readonly Cell[]): 'x' | 'o' | 'draw' | null {
  for (const [a, b, c] of LINES) {
    if (board[a] !== '-' && board[a] === board[b] && board[a] === board[c]) return board[a] as 'x' | 'o';
  }
  return board.includes('-') ? null : 'draw';
}

function score(board: Cell[], me: 'x' | 'o', depth: number): number {
  const w = winner(board);
  if (w === me) return 10 - depth;
  if (w === 'draw') return 0;
  if (w) return depth - 10;
  const mover = turn(board);
  const scores = board.flatMap((c, i) => {
    if (c !== '-') return [];
    board[i] = mover;
    const s = score(board, me, depth + 1);
    board[i] = '-';
    return [s];
  });
  return mover === me ? Math.max(...scores) : Math.min(...scores);
}

/** guiBot's move. Plays perfectly, but picks randomly among equally good moves so games differ. */
export function bestMove(board: readonly Cell[], rng: () => number = Math.random): number {
  const me = turn(board);
  const work = [...board];
  let best = -Infinity;
  let moves: number[] = [];
  work.forEach((c, i) => {
    if (c !== '-') return;
    work[i] = me;
    const s = score(work, me, 1);
    work[i] = '-';
    if (s > best) [best, moves] = [s, [i]];
    else if (s === best) moves.push(i);
  });
  return moves[Math.floor(rng() * moves.length)]!;
}

export const encode = (g: Game, cell: number): string => `${TTT_PREFIX}${g.x}:${g.o}:${g.board.join('')}:${cell}`;

export function decode(customId: string): { game: Game; cell: number } | null {
  const [x, o, board, cell] = customId.slice(TTT_PREFIX.length).split(':');
  if (!x || !o || !board || !/^[xo-]{9}$/.test(board) || !cell || !/^[0-8]$/.test(cell)) return null;
  return { game: { x, o, board: board.split('') as Cell[] }, cell: Number(cell) };
}

export type MoveResult = { ok: true; game: Game } | { ok: false; reason: string };

/** Applies a click from `userId`, then guiBot's reply when it's playing. */
export function play(game: Game, cell: number, userId: string, rng?: () => number): MoveResult {
  if (winner(game.board)) return { ok: false, reason: 'This game is already over.' };
  if (userId !== game.x && userId !== game.o) return { ok: false, reason: "You're not in this game. Start your own with `/tictactoe`." };
  const mark = turn(game.board);
  if (game[mark] !== userId) return { ok: false, reason: "It's not your turn." };
  if (game.board[cell] !== '-') return { ok: false, reason: 'That square is taken.' };
  const board = [...game.board];
  board[cell] = mark;
  if (game.o === BOT && !winner(board)) board[bestMove(board, rng)] = 'o';
  return { ok: true, game: { ...game, board } };
}

const who = (id: string) => (id === BOT ? 'guiBot' : `<@${id}>`);

export function render(game: Game): Pick<InteractionUpdateOptions, 'embeds' | 'components'> {
  const w = winner(game.board);
  const status =
    w === 'draw' ? "It's a draw." : w ? `${who(game[w])} wins.` : `${who(game[turn(game.board)])}'s turn (${turn(game.board) === 'x' ? '❌' : '⭕'}).`;
  const embed = info(`❌ ${who(game.x)} vs ⭕ ${who(game.o)}\n\n${status}`, 'Tic-tac-toe');
  const rows = [0, 1, 2].map((r) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      [0, 1, 2].map((c) => {
        const i = r * 3 + c;
        const cell = game.board[i];
        const button = new ButtonBuilder()
          .setCustomId(encode(game, i))
          .setStyle(cell === 'x' ? ButtonStyle.Danger : cell === 'o' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(cell !== '-' || w !== null);
        return cell === '-' ? button.setLabel('​') : button.setEmoji(cell === 'x' ? '✖️' : '⭕');
      }),
    ),
  );
  return { embeds: [embed], components: rows };
}
