import { EmbedBuilder } from 'discord.js';
import type { Slip, SlipPick } from './lineups.js';

export const PRIZEPICKS_PURPLE = 0x6c2bd9;

export const profileUrl = (profileId: string): string => `https://app.prizepicks.com/p/${profileId}/open-lineups`;

const unix = (d: Date): number => Math.floor(d.getTime() / 1000);
const dollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const ODDS_TAG: Record<string, string> = { demon: ' 😈', goblin: ' 👺' };

export function pickLine(p: SlipPick): string {
  const arrow = p.direction === 'more' ? '⬆️ More' : '⬇️ Less';
  const team = p.team ? ` ${p.team}` : '';
  const when = [p.context ? `vs ${p.context}` : null, p.startsAt ? `<t:${unix(p.startsAt)}:f>` : null].filter(Boolean).join(' · ');
  return `**${p.player}**${team} · ${arrow} **${p.line}** ${p.stat}${ODDS_TAG[p.oddsType] ?? ''}${when ? `\n-# ${when}` : ''}`;
}

export interface Tracked {
  profileId: string;
  username: string | null;
  avatarUrl: string | null;
}

export function slipEmbed(slip: Slip, who: Tracked): EmbedBuilder {
  const name = who.username ?? who.profileId;
  const size = slip.picks.length || 'multi';
  const embed = new EmbedBuilder()
    .setColor(PRIZEPICKS_PURPLE)
    .setAuthor({ name, iconURL: who.avatarUrl ?? undefined, url: profileUrl(who.profileId) })
    .setTitle(`New ${size}-pick ${slip.playType}${slip.freePlay ? ' (free)' : ''}`)
    .setURL(profileUrl(who.profileId))
    .setDescription(slip.picks.map(pickLine).join('\n').slice(0, 4096) || '*No picks came through.*')
    .addFields(
      { name: 'Entry', value: dollars(slip.entryCents), inline: true },
      {
        name: 'To win',
        value: `${dollars(slip.toWinCents)}${slip.multiplier ? ` (${slip.multiplier}x)` : ''}`,
        inline: true,
      },
      { name: 'Placed', value: `<t:${unix(slip.createdAt)}:R>`, inline: true },
    )
    .setFooter({ text: `PrizePicks${slip.sport ? ` · ${slip.sport}` : ''} · slip ${slip.id}` })
    .setTimestamp(slip.createdAt);
  return embed;
}
