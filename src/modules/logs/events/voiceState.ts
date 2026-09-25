import { Events, type VoiceState } from 'discord.js';
import { event } from '../../../core/define.js';
import { asLogUser, voiceMoved } from '../lib/render.js';
import { postLog } from '../lib/routes.js';

export default event({
  name: Events.VoiceStateUpdate,
  async run(before: VoiceState, after: VoiceState) {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const embed = voiceMoved(asLogUser(member.user), before.channelId, after.channelId);
    if (embed) await postLog(after.client, after.guild.id, 'voice', { embeds: [embed] });
  },
});
