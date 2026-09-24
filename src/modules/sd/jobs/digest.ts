import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { parseGemini } from '../../../env.js';
import { withStatusParagraph } from '../../ai/lib/digest.js';
import { createGemini } from '../../ai/lib/gemini.js';
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
    let digest = await buildDigest(guildId);
    const gemini = settings.aiDigest ? parseGemini(process.env) : undefined;
    if (gemini) digest = await withStatusParagraph(digest, createGemini(gemini));
    await sendTo(client, settings.digestChannelId, {
      embeds: [digest],
      allowedMentions: { parse: [] },
    });
  },
});
