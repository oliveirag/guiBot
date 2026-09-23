import type { APIEmbed, Client, EmbedBuilder } from 'discord.js';
import { vi } from 'vitest';

export interface Sent {
  channelId: string;
  message: { content?: string; embeds?: EmbedBuilder[]; components?: unknown[]; allowedMentions?: unknown };
}

export interface Edited {
  channelId: string;
  messageId: string;
  edit: { embeds?: EmbedBuilder[]; components?: unknown[] };
}

/** A Discord client that records sends, edits, and scheduled events. `fail` makes a channel throw on fetch. */
export function fakeDiscord(fail: Record<string, Error> = {}) {
  let seq = 100;
  const sent: Sent[] = [];
  const edits: Edited[] = [];
  const events: Record<string, unknown>[] = [];
  const deletedEvents: string[] = [];
  const client = {
    channels: {
      fetch: vi.fn(async (channelId: string) => {
        if (fail[channelId]) throw fail[channelId];
        return {
          isSendable: () => true,
          isTextBased: () => true,
          send: vi.fn(async (message: Sent['message']) => {
            sent.push({ channelId, message });
            return { id: `m${seq++}` };
          }),
          messages: {
            fetch: vi.fn(async (messageId: string) => ({
              edit: vi.fn(async (edit: Edited['edit']) => {
                edits.push({ channelId, messageId, edit });
              }),
            })),
          },
        };
      }),
    },
    guilds: {
      fetch: vi.fn(async () => ({
        scheduledEvents: {
          create: vi.fn(async (e: Record<string, unknown>) => {
            events.push(e);
            return { id: `e${seq++}` };
          }),
          delete: vi.fn(async (id: string) => {
            deletedEvents.push(id);
          }),
        },
      })),
    },
  } as unknown as Client;
  return { client, sent, edits, events, deletedEvents };
}

export const embeds = (message: { embeds?: EmbedBuilder[] }): APIEmbed[] => (message.embeds ?? []).map((e) => e.toJSON());

export const apiError = (code: number) => Object.assign(new Error(`api ${code}`), { code });
