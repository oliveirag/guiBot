import type { DevEvent } from '@prisma/client';
import type { Client } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_COLOR, ERROR_COLOR, SUCCESS_COLOR } from '../../../src/core/embeds.js';
import { log } from '../../../src/core/log.js';
import { prisma } from '../../../src/db.js';
import notify from '../../../src/modules/dev/jobs/notify.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import { renderEvent } from '../../../src/modules/dev/lib/render.js';
import { setFailureRole } from '../../../src/modules/dev/lib/settings.js';
import { resetDb } from '../../db.js';

let seq = 0;

function storeEvent(extra: Partial<Pick<DevEvent, 'kind' | 'title' | 'url' | 'detail'>> = {}) {
  return prisma.devEvent.create({
    data: {
      deliveryId: `github:test-${seq++}#0`,
      source: 'github',
      kind: 'pr.merged',
      key: 'o/r',
      actor: 'gui',
      actorName: 'gui',
      title: '#1 Ship it',
      url: 'https://github.com/o/r/pull/1',
      detail: 'Merged into main by ana',
      ...extra,
    },
  });
}

const apiError = (code: number) => Object.assign(new Error(`api ${code}`), { code });

function fakeClient(channel: unknown, fetchError?: Error) {
  const fetch = vi.fn(async () => {
    if (fetchError) throw fetchError;
    return channel;
  });
  return { client: { channels: { fetch } } as unknown as Client, fetch };
}

function sendable(send = vi.fn(async (_message: unknown) => ({}))) {
  return { channel: { isSendable: () => true, send }, send };
}

describe('renderEvent', () => {
  beforeEach(resetDb);

  it('renders the label, repo, title, link, and detail', async () => {
    const json = renderEvent(await storeEvent()).toJSON();
    expect(json).toMatchObject({
      color: BRAND_COLOR,
      author: { name: 'Pull request merged · o/r' },
      title: '#1 Ship it',
      url: 'https://github.com/o/r/pull/1',
      description: 'Merged into main by ana',
    });
    expect(json.timestamp).toBeDefined();
  });

  it('colors failed workflows red', async () => {
    expect(renderEvent(await storeEvent({ kind: 'workflow.failed' })).toJSON().color).toBe(ERROR_COLOR);
  });

  it('colors fixed workflows and approvals green', async () => {
    const fixed = renderEvent(await storeEvent({ kind: 'workflow.fixed' })).toJSON();
    expect(fixed.color).toBe(SUCCESS_COLOR);
    expect(fixed.author?.name).toBe('Back to green · o/r');
    const approved = renderEvent(await storeEvent({ kind: 'pr.approved' })).toJSON();
    expect(approved.color).toBe(SUCCESS_COLOR);
    expect(approved.author?.name).toBe('Pull request approved · o/r');
  });

  it('labels review requests and change requests', async () => {
    expect(renderEvent(await storeEvent({ kind: 'pr.review_requested' })).toJSON().author?.name).toBe('Review requested · o/r');
    expect(renderEvent(await storeEvent({ kind: 'pr.changes_requested' })).toJSON().author?.name).toBe('Changes requested · o/r');
  });

  it('clips long titles', async () => {
    const title = renderEvent(await storeEvent({ title: 'x'.repeat(400) })).toJSON().title!;
    expect(title).toHaveLength(256);
    expect(title.endsWith('…')).toBe(true);
  });

  it('skips non-http urls and missing details', async () => {
    const json = renderEvent(await storeEvent({ url: 'javascript:alert(1)', detail: null })).toJSON();
    expect(json.url).toBeUndefined();
    expect(json.description).toBeUndefined();
  });
});

describe('dev.notify', () => {
  beforeEach(resetDb);

  const ctx = (client: Client) => ({ id: 1, guildId: 'g1', client });

  it('posts the rendered event to the channel', async () => {
    const event = await storeEvent();
    const { channel, send } = sendable();
    const { client, fetch } = fakeClient(channel);
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(client));
    expect(fetch).toHaveBeenCalledWith('c1');
    const embed = (send.mock.calls[0]![0] as { embeds: { toJSON(): { title?: string } }[] }).embeds[0]!.toJSON();
    expect(embed.title).toBe('#1 Ship it');
  });

  it('pings the failure role on failed workflows, and only mentions that role', async () => {
    await setFailureRole('g1', 'r1');
    const event = await storeEvent({ kind: 'workflow.failed' });
    const { channel, send } = sendable();
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(channel).client));
    expect(send.mock.calls[0]![0]).toMatchObject({ content: '<@&r1>', allowedMentions: { roles: ['r1'] } });
  });

  it('does not ping for other events or when no role is set', async () => {
    await setFailureRole('g1', 'r1');
    const merged = await storeEvent();
    const first = sendable();
    await notify.run({ eventId: merged.id, channelId: 'c1' }, ctx(fakeClient(first.channel).client));
    expect(first.send.mock.calls[0]![0]).not.toHaveProperty('content');

    await setFailureRole('g1', null);
    const failed = await storeEvent({ kind: 'workflow.failed' });
    const second = sendable();
    await notify.run({ eventId: failed.id, channelId: 'c1' }, ctx(fakeClient(second.channel).client));
    expect(second.send.mock.calls[0]![0]).not.toHaveProperty('content');
  });

  it('does nothing when the event row is gone', async () => {
    const { client, fetch } = fakeClient(sendable().channel);
    await notify.run({ eventId: 999, channelId: 'c1' }, ctx(client));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops feeds for a deleted channel', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g1', 'jira', 'SD', 'c1');
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(null, apiError(10003)).client));
    expect(await prisma.devFeed.count()).toBe(0);
    warn.mockRestore();
  });

  it('keeps feeds when the channel fetch comes back empty without an error', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(null).client));
    expect(await prisma.devFeed.count()).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops feeds for a channel that can no longer take messages', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient({ isSendable: () => false }).client));
    expect(await prisma.devFeed.count()).toBe(0);
    warn.mockRestore();
  });

  it('gives up quietly without permission and keeps the feed', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    const { channel } = sendable(
      vi.fn(async () => {
        throw apiError(50013);
      }),
    );
    await expect(notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(channel).client))).resolves.toBeUndefined();
    expect(await prisma.devFeed.count()).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws other errors so the scheduler retries', async () => {
    const event = await storeEvent();
    const { channel } = sendable(
      vi.fn(async () => {
        throw new Error('gateway hiccup');
      }),
    );
    await expect(notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(channel).client))).rejects.toThrow(
      'gateway hiccup',
    );
  });
});
