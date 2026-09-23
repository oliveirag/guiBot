import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR, UserError, reportError } from '../../src/core/errors.js';
import { info } from '../../src/core/embeds.js';
import { respond } from '../../src/core/reply.js';
import { asInteraction, fakeInteraction, lastEmbed, silentLog } from '../helpers.js';

describe('respond', () => {
  it('replies ephemerally when nothing was sent yet', async () => {
    const i = fakeInteraction();
    await respond(asInteraction(i), info('hi'));
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('edits the deferred reply', async () => {
    const i = fakeInteraction({ deferred: true });
    await respond(asInteraction(i), info('hi'));
    expect(i.editReply).toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('follows up after a reply', async () => {
    const i = fakeInteraction({ replied: true });
    await respond(asInteraction(i), info('hi'));
    expect(i.followUp).toHaveBeenCalled();
  });
});

describe('reportError', () => {
  it('shows UserError messages without logging', async () => {
    const i = fakeInteraction();
    const log = silentLog();
    await reportError(asInteraction(i), new UserError('Pick a smaller number.'), log);
    expect(lastEmbed(i.reply).description).toContain('Pick a smaller number.');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('hides unexpected errors and logs them', async () => {
    const i = fakeInteraction();
    const log = silentLog();
    await reportError(asInteraction(i), new Error('db exploded'), log);
    expect(lastEmbed(i.reply).description).toContain(GENERIC_ERROR);
    expect(lastEmbed(i.reply).description).not.toContain('db exploded');
    expect(log.error).toHaveBeenCalled();
  });

  it('logs instead of throwing if the error reply itself fails', async () => {
    const i = fakeInteraction();
    i.reply.mockRejectedValueOnce(new Error('unknown interaction'));
    const log = silentLog();
    await expect(reportError(asInteraction(i), new UserError('x'), log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
