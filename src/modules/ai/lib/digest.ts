import type { EmbedBuilder } from 'discord.js';
import { log } from '../../../core/log.js';
import type { Generate } from './gemini.js';
import { DIGEST_INSTRUCTIONS, PERSONA } from './persona.js';

const PARAGRAPH_CHARS = 600;

/** Strips Discord markup so the model sees plain facts. */
export function digestText(embed: EmbedBuilder): string {
  return (embed.data.description ?? '')
    .replace(/<t:\d+(:\w)?>/g, '')
    .replace(/<@!?(\d+)>/g, 'a teammate')
    .replace(/\*\*/g, '');
}

/** Puts a short AI status paragraph on top of the digest. Leaves the digest alone if the model fails. */
export async function withStatusParagraph(embed: EmbedBuilder, generate: Generate): Promise<EmbedBuilder> {
  try {
    const raw = await generate({
      system: `${PERSONA}\n\n${DIGEST_INSTRUCTIONS}`,
      prompt: digestText(embed),
      maxTokens: 250,
    });
    const paragraph = raw.replace(/@(everyone|here)/g, '@\u200b$1').replace(/\s+/g, ' ').trim().slice(0, PARAGRAPH_CHARS);
    if (!paragraph) return embed;
    return embed.setDescription(`*${paragraph}*\n\n${embed.data.description ?? ''}`.slice(0, 4096));
  } catch (error) {
    log.warn('ai: digest paragraph failed', error);
    return embed;
  }
}
