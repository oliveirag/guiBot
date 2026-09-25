import { z } from 'zod';
import { UserError } from '../../../core/errors.js';

export type JsonFetch = (url: string) => Promise<unknown>;

const TIMEOUT_MS = 8_000;

export const fetchJson: JsonFetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'guiBot' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

const DOWN = "That service isn't answering. Try again in a bit.";

async function get<T>(schema: z.ZodType<T>, url: string, fetcher: JsonFetch): Promise<T> {
  let body: unknown;
  try {
    body = await fetcher(url);
  } catch {
    throw new UserError(DOWN);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UserError(DOWN);
  return parsed.data;
}

export async function catImage(fetcher: JsonFetch = fetchJson): Promise<string> {
  const [first] = await get(z.array(z.object({ url: z.string().url() })).min(1), 'https://api.thecatapi.com/v1/images/search', fetcher);
  return first!.url;
}

export async function dogImage(fetcher: JsonFetch = fetchJson): Promise<string> {
  return (await get(z.object({ message: z.string().url() }), 'https://dog.ceo/api/breeds/image/random', fetcher)).message;
}

const meme = z.object({
  title: z.string(),
  url: z.string().url(),
  postLink: z.string().url(),
  subreddit: z.string(),
  nsfw: z.boolean(),
  spoiler: z.boolean(),
});
export type Meme = z.infer<typeof meme>;

/** A safe-for-work meme. Retries a few times past NSFW or spoiler posts. */
export async function randomMeme(fetcher: JsonFetch = fetchJson): Promise<Meme> {
  for (let i = 0; i < 3; i++) {
    const m = await get(meme, 'https://meme-api.com/gimme', fetcher);
    if (!m.nsfw && !m.spoiler) return m;
  }
  throw new UserError("Couldn't find a clean meme this time. Try again.");
}
