import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { JOBS } from '../lib/schedule.js';
import { getSettings } from '../lib/settings.js';
import { openStandup, scheduleNextOpen } from '../lib/standups.js';

const payloadSchema = z.object({ version: z.number().int() });

export default job({
  type: JOBS.standupOpen,
  async run(payload, { client, guildId }) {
    const { version } = payloadSchema.parse(payload);
    if (!guildId) return;
    const settings = await getSettings(guildId);
    // A newer schedule replaced this one, or standups were turned off.
    if (settings.standupVersion !== version || !settings.standupChannelId) return;
    // Queue the next one first so a failure here doesn't end the series. scheduleOnce makes retries safe.
    await scheduleNextOpen(settings, new Date());
    if (!(await isModuleEnabled(guildId, 'sd'))) return;
    await openStandup(client, guildId);
  },
});
