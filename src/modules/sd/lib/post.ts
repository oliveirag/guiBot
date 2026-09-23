import { RESTJSONErrorCodes, type Client, type Message, type MessageCreateOptions, type MessageEditOptions } from 'discord.js';
import { log } from '../../../core/log.js';

// Errors that retrying won't fix: the channel or message is gone, or the bot lost access.
const PERMANENT = new Set<unknown>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

export const isPermanent = (error: unknown): boolean => PERMANENT.has(codeOf(error));

/** Sends to a channel. Returns null (and logs) when the channel is gone or off limits; other errors throw so jobs retry. */
export async function sendTo(client: Client, channelId: string, message: MessageCreateOptions): Promise<Message | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) {
      log.warn(`sd: can't post in channel ${channelId}`);
      return null;
    }
    return await channel.send(message);
  } catch (error) {
    if (!isPermanent(error)) throw error;
    log.warn(`sd: can't post in channel ${channelId}`, error);
    return null;
  }
}

/** Edits a message the bot posted. Returns false when it's gone or off limits. */
export async function editIn(
  client: Client,
  channelId: string,
  messageId: string,
  edit: MessageEditOptions,
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return false;
    const message = await channel.messages.fetch(messageId);
    await message.edit(edit);
    return true;
  } catch (error) {
    if (!isPermanent(error)) throw error;
    return false;
  }
}
