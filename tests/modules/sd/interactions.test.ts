import type { Interaction } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../src/modules/sd/events/interactions.js';
import { createMeeting } from '../../../src/modules/sd/lib/meetings.js';
import { closeStandup, configureStandup, openStandup } from '../../../src/modules/sd/lib/standups.js';
import { resetDb } from '../../db.js';
import { embeds, fakeDiscord } from './fakes.js';

const now = new Date('2026-09-23T13:00:00Z');

function fakeInteraction(kind: 'button' | 'modal', customId: string, extra: Record<string, unknown> = {}) {
  const { client, edits } = fakeDiscord();
  const i = {
    customId,
    guildId: 'g1',
    user: { id: 'u1' },
    client,
    replied: false,
    deferred: false,
    inCachedGuild: () => true,
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    showModal: vi.fn(async () => {}),
    reply: vi.fn(async (_payload: unknown) => {
      i.replied = true;
    }),
    followUp: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    update: vi.fn(async (_payload: unknown) => {}),
    ...extra,
  };
  return { i, edits, run: () => handler.run(i as unknown as Interaction) };
}

const replyText = (i: { reply: { mock: { calls: unknown[][] } } }) =>
  embeds(i.reply.mock.calls[0]![0] as never)[0]!.description;

describe('sd interaction handler', () => {
  beforeEach(async () => {
    await resetDb();
    await configureStandup(
      'g1',
      { channelId: 'c1', clock: { hour: 10, minute: 0 }, days: [1, 2, 3, 4, 5], windowHours: 4 },
      now,
    );
  });

  it('ignores components that are not ours', async () => {
    const { i, run } = fakeInteraction('button', 'other:thing');
    await run();
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.showModal).not.toHaveBeenCalled();
  });

  it('opens the standup form from the button', async () => {
    const { standup } = await openStandup(fakeDiscord().client, 'g1', now);
    const { i, run } = fakeInteraction('button', `sd:standup:${standup.id}`);
    await run();
    expect(i.showModal).toHaveBeenCalledOnce();
  });

  it('saves the form and updates the standup post', async () => {
    const { standup } = await openStandup(fakeDiscord().client, 'g1', now);
    const answers: Record<string, string> = { yesterday: 'auth', today: 'tests', blockers: '' };
    const { i, edits, run } = fakeInteraction('modal', `sd:standup-modal:${standup.id}`, {
      fields: { getTextInputValue: (id: string) => answers[id] },
    });
    await run();
    expect(replyText(i)).toContain("You're in");
    expect(embeds(edits[0]!.edit)[0]!.description).toContain('**In (1)** <@u1>');
  });

  it('tells people when the standup already closed', async () => {
    const { standup } = await openStandup(fakeDiscord().client, 'g1', now);
    await closeStandup(fakeDiscord().client, standup.id, now);
    const { i, run } = fakeInteraction('button', `sd:standup:${standup.id}`);
    await run();
    expect(i.showModal).not.toHaveBeenCalled();
    expect(replyText(i)).toMatch(/already closed/);
  });

  it('records an RSVP and redraws the meeting post in place', async () => {
    const meeting = await createMeeting(
      {
        guildId: 'g1',
        channelId: 'c1',
        title: 'Sync',
        location: null,
        startsAt: new Date('2026-12-01T00:00:00Z'),
        durationMin: 60,
        weekly: false,
        createdBy: 'u9',
      },
      now,
    );
    const { i, run } = fakeInteraction('button', `sd:rsvp:${meeting.id}:yes`);
    await run();
    const update = i.update.mock.calls[0]![0] as { embeds: never[] };
    expect(embeds(update)[0]!.fields![0]).toMatchObject({ name: 'Going (1)', value: '<@u1>' });
  });

  it('rejects a tampered RSVP button', async () => {
    const { i, run } = fakeInteraction('button', 'sd:rsvp:1:always');
    await run();
    expect(i.update).not.toHaveBeenCalled();
    expect(replyText(i)).toMatch(/broken/);
  });
});
