import { Events, type VoiceState } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, voiceMoved } from '../lib/render.js';
import { isIgnored, postLog } from '../lib/routes.js';

export default event({
  name: Events.VoiceStateUpdate,
  async run(before: VoiceState, after: VoiceState) {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const embed = voiceMoved(asLogUser(member.user), before.channelId, after.channelId);
    if (!embed) return;
    // A move between an ignored channel and a watched one still gets logged.
    const involved = [before.channelId, after.channelId].filter((id): id is string => id !== null);
    const ignored = await Promise.all(involved.map((id) => isIgnored(after.client, after.guild.id, id)));
    if (ignored.every(Boolean)) return;
    await postLog(after.client, after.guild.id, 'voice', { embeds: [embed] });
  },
});
