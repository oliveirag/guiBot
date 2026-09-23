import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { buildDigest, scheduleNextDigest } from '../lib/digest.js';
import { sendTo } from '../lib/post.js';
import { JOBS } from '../lib/schedule.js';
import { getSettings } from '../lib/settings.js';

const payloadSchema = z.object({ version: z.number().int() });

export default job({
  type: JOBS.digest,
  async run(payload, { client, guildId }) {
    const { version } = payloadSchema.parse(payload);
    if (!guildId) return;
    const settings = await getSettings(guildId);
    if (settings.digestVersion !== version || !settings.digestChannelId) return;
    await scheduleNextDigest(settings, new Date());
    if (!(await isModuleEnabled(guildId, 'sd'))) return;
    await sendTo(client, settings.digestChannelId, {
      embeds: [await buildDigest(guildId)],
      allowedMentions: { parse: [] },
    });
  },
});
