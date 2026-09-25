import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from 'discord.js';
import { z } from 'zod';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { fetchJson, type JsonFetch } from './media.js';
import { shuffle, type Rng } from './random.js';

export const TRIVIA_PREFIX = 'trivia:';
export const ROUND_SECONDS = 20;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

export const CATEGORIES = [
  { name: 'General knowledge', value: 9 },
  { name: 'Books', value: 10 },
  { name: 'Film', value: 11 },
  { name: 'Music', value: 12 },
  { name: 'Video games', value: 15 },
  { name: 'Science and nature', value: 17 },
  { name: 'Computers', value: 18 },
  { name: 'Math', value: 19 },
  { name: 'Sports', value: 21 },
  { name: 'Geography', value: 22 },
  { name: 'History', value: 23 },
  { name: 'Anime and manga', value: 31 },
] as const;

export interface Question {
  category: string;
  difficulty: string;
  text: string;
  answers: string[];
  correct: number;
}

const response = z.object({
  response_code: z.number(),
  results: z.array(
    z.object({
      category: z.string(),
      difficulty: z.string(),
      question: z.string(),
      correct_answer: z.string(),
      incorrect_answers: z.array(z.string()),
    }),
  ),
});

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export async function fetchQuestion(
  opts: { category?: number | null; difficulty?: string | null },
  fetcher: JsonFetch = fetchJson,
  rng?: Rng,
): Promise<Question> {
  const url = new URL('https://opentdb.com/api.php?amount=1&encode=url3986');
  if (opts.category) url.searchParams.set('category', String(opts.category));
  if (opts.difficulty) url.searchParams.set('difficulty', opts.difficulty);
  let body: unknown;
  try {
    body = await fetcher(url.toString());
  } catch {
    throw new UserError("The trivia service isn't answering. Try again in a bit.");
  }
  const parsed = response.safeParse(body);
  // Open Trivia DB allows one request every 5 seconds per IP.
  if (parsed.success && parsed.data.response_code === 5) throw new UserError('Trivia needs a breather. Try again in a few seconds.');
  const q = parsed.success && parsed.data.response_code === 0 ? parsed.data.results[0] : undefined;
  if (!q) throw new UserError("Couldn't get a question. Try again.");
  const correct = decode(q.correct_answer);
  const answers = q.incorrect_answers.length === 1 ? ['True', 'False'] : shuffle([correct, ...q.incorrect_answers.map(decode)], rng);
  return {
    category: decode(q.category),
    difficulty: q.difficulty,
    text: decode(q.question),
    answers,
    correct: answers.indexOf(correct),
  };
}

/** Open rounds, by round id. A restart drops them, and late clicks get told the round is over. */
export interface Round {
  question: Question;
  guesses: Map<string, number>;
}
export const rounds = new Map<string, Round>();

export function renderRound(roundId: string, q: Question, reveal?: { winners: string[]; guessers: number }) {
  const lines = [`**${q.text}**`, '', ...q.answers.map((a, i) => `${LETTERS[i]}. ${a}`)];
  if (reveal) {
    lines.push('', `Answer: **${LETTERS[q.correct]}. ${q.answers[q.correct]}**`);
    lines.push(
      reveal.winners.length
        ? `Got it: ${reveal.winners.map((id) => `<@${id}>`).join(', ')}`
        : reveal.guessers
          ? 'Nobody got it.'
          : 'Nobody guessed.',
    );
  } else {
    lines.push('', `One guess each. Answer in ${ROUND_SECONDS}s.`);
  }
  const embed = info(lines.join('\n'), 'Trivia').setFooter({ text: `${q.category} · ${q.difficulty}` });
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    q.answers.map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`${TRIVIA_PREFIX}${roundId}:${i}`)
        .setLabel(LETTERS[i]!)
        .setStyle(reveal ? (i === q.correct ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Primary)
        .setDisabled(Boolean(reveal)),
    ),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** Records one guess per person. Returns false if they already guessed. */
export function guess(round: Round, userId: string, answer: number): boolean {
  if (round.guesses.has(userId)) return false;
  round.guesses.set(userId, answer);
  return true;
}

export const winnersOf = (round: Round): string[] =>
  [...round.guesses].filter(([, a]) => a === round.question.correct).map(([id]) => id);
