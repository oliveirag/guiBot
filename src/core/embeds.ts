import { EmbedBuilder } from 'discord.js';

export const BRAND_COLOR = 0x3b82f6;
export const ERROR_COLOR = 0xef4444;

function build(color: number, description: string, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

export const info = (description: string, title?: string): EmbedBuilder => build(BRAND_COLOR, description, title);
export const ok = (description: string, title?: string): EmbedBuilder => build(BRAND_COLOR, `✓ ${description}`, title);
export const err = (description: string, title?: string): EmbedBuilder => build(ERROR_COLOR, `✕ ${description}`, title);
