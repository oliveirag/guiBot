import type { DevEvent } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR, SUCCESS_COLOR } from '../../../core/embeds.js';
import type { DevEventKind } from './types.js';

const LABEL: Record<DevEventKind, string> = {
  'pr.opened': 'Pull request opened',
  'pr.merged': 'Pull request merged',
  'pr.review_requested': 'Review requested',
  'pr.approved': 'Pull request approved',
  'pr.changes_requested': 'Changes requested',
  'workflow.failed': 'Workflow failed',
  'workflow.succeeded': 'Workflow passed',
  'workflow.fixed': 'Back to green',
  'release.published': 'Release published',
  push: 'Pushed',
  'issue.created': 'Issue created',
  'issue.transitioned': 'Issue moved',
  'issue.done': 'Issue done',
  'issue.assigned': 'Issue assigned',
};

const COLOR: Partial<Record<DevEventKind, number>> = {
  'workflow.failed': ERROR_COLOR,
  'workflow.fixed': SUCCESS_COLOR,
  'pr.approved': SUCCESS_COLOR,
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function renderEvent(event: DevEvent): EmbedBuilder {
  const kind = event.kind as DevEventKind;
  const label = LABEL[kind] ?? event.kind;
  const embed = new EmbedBuilder()
    .setColor(COLOR[kind] ?? BRAND_COLOR)
    .setAuthor({ name: clip(`${label} · ${event.key}`, 256) })
    .setTitle(clip(event.title, 256))
    .setTimestamp(event.createdAt);
  if (event.url && /^https?:\/\//.test(event.url)) embed.setURL(event.url);
  if (event.detail) embed.setDescription(clip(event.detail, 4096));
  return embed;
}
