import { z } from 'zod';
import type { GeminiAccess } from '../../../env.js';

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** Turns a prompt into text. The real one calls Gemini; tests pass a fake. */
export type Generate = (req: GenerateRequest) => Promise<string>;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'GeminiError';
  }

  get busy(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

const TIMEOUT_MS = 30_000;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const response = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

export function createGemini(access: GeminiAccess, fetchImpl: FetchLike = fetch): Generate {
  return async ({ system, prompt, maxTokens = 600 }) => {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // Thinking off: replies should be quick and short.
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } },
    };
    let res;
    try {
      res = await fetchImpl(`${API}/${encodeURIComponent(access.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': access.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GeminiError(`Gemini request failed: ${(error as Error).message}`);
    }
    if (!res.ok) throw new GeminiError(`Gemini answered ${res.status}`, res.status);

    const parsed = response.parse(await res.json());
    if (parsed.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked it: ${parsed.promptFeedback.blockReason}`);
    const text = (parsed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) throw new GeminiError('Gemini came back empty');
    return text;
  };
}
