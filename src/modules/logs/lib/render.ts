import { EmbedBuilder, type User } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR, SUCCESS_COLOR } from '../../../core/embeds.js';

export interface LogUser {
  id: string;
  tag: string;
  avatarUrl?: string | null;
}

export const asLogUser = (u: Pick<User, 'id' | 'tag' | 'displayAvatarURL'>): LogUser => ({
  id: u.id,
  tag: u.tag,
  avatarUrl: u.displayAvatarURL(),
});

const FIELD = 1024;
const clip = (text: string, max = FIELD): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const ts = (d: Date, style = 'R'): string => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

function base(color: number, user: LogUser, title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: user.tag, iconURL: user.avatarUrl ?? undefined })
    .setTitle(title)
    .setFooter({ text: `User ${user.id}` })
    .setTimestamp(new Date());
}

export interface DeletedMessage {
  author: LogUser | null;
  channelId: string;
  content: string | null;
  attachments: string[];
  createdAt: Date | null;
}

export function messageDeleted(m: DeletedMessage): EmbedBuilder {
  const user = m.author ?? { id: 'unknown', tag: 'Unknown user' };
  const lines = [`**Channel** <#${m.channelId}>`];
  if (m.createdAt) lines.push(`**Sent** ${ts(m.createdAt)}`);
  const embed = base(ERROR_COLOR, user, 'Message deleted').setDescription(lines.join('\n'));
  embed.addFields({ name: 'Content', value: m.content ? clip(m.content) : "*Not cached, so I can't show it.*" });
  if (m.attachments.length > 0) embed.addFields({ name: 'Attachments', value: clip(m.attachments.join('\n')) });
  return embed;
}

export function messageEdited(author: LogUser, channelId: string, url: string, before: string | null, after: string): EmbedBuilder {
  return base(BRAND_COLOR, author, 'Message edited')
    .setDescription(`**Channel** <#${channelId}> · [Jump](${url})`)
    .addFields(
      { name: 'Before', value: before ? clip(before) : '*Not cached.*' },
      { name: 'After', value: clip(after || '*Empty*') },
    );
}

export function bulkDeleted(channelId: string, count: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle('Messages purged')
    .setDescription(`**${count}** messages deleted in <#${channelId}>`)
    .setTimestamp(new Date());
}

export function memberJoined(user: LogUser, accountCreated: Date, memberCount: number, now = new Date()): EmbedBuilder {
  const ageDays = Math.floor((now.getTime() - accountCreated.getTime()) / 86_400_000);
  const fresh = ageDays < 7 ? ' ⚠️ new account' : '';
  return base(SUCCESS_COLOR, user, 'Member joined').setDescription(
    [`<@${user.id}> is member #${memberCount}`, `**Account created** ${ts(accountCreated)}${fresh}`].join('\n'),
  );
}

export function memberLeft(user: LogUser, joinedAt: Date | null, roleIds: string[]): EmbedBuilder {
  const lines = [`<@${user.id}> left`];
  if (joinedAt) lines.push(`**Joined** ${ts(joinedAt)}`);
  if (roleIds.length > 0) lines.push(`**Roles** ${clip(roleIds.map((r) => `<@&${r}>`).join(' '), 900)}`);
  return base(ERROR_COLOR, user, 'Member left').setDescription(lines.join('\n'));
}

export function rolesChanged(user: LogUser, added: string[], removed: string[]): EmbedBuilder {
  const lines = [`<@${user.id}>`];
  if (added.length > 0) lines.push(`**Added** ${added.map((r) => `<@&${r}>`).join(' ')}`);
  if (removed.length > 0) lines.push(`**Removed** ${removed.map((r) => `<@&${r}>`).join(' ')}`);
  return base(BRAND_COLOR, user, 'Roles changed').setDescription(clip(lines.join('\n'), 4096));
}

export function nickChanged(user: LogUser, before: string | null, after: string | null): EmbedBuilder {
  return base(BRAND_COLOR, user, 'Nickname changed').setDescription(
    `<@${user.id}>\n**Before** ${before ?? '*none*'}\n**After** ${after ?? '*none*'}`,
  );
}

export function voiceMoved(user: LogUser, from: string | null, to: string | null): EmbedBuilder | null {
  if (from === to) return null;
  if (!from) return base(SUCCESS_COLOR, user, 'Joined voice').setDescription(`<@${user.id}> joined <#${to}>`);
  if (!to) return base(ERROR_COLOR, user, 'Left voice').setDescription(`<@${user.id}> left <#${from}>`);
  return base(BRAND_COLOR, user, 'Moved voice').setDescription(`<@${user.id}> <#${from}> → <#${to}>`);
}

/** Role ids in `after` but not `before`, and the reverse. */
export function roleDiff(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((r) => !b.has(r)), removed: [...b].filter((r) => !a.has(r)) };
}
