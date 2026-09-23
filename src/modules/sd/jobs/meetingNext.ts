import { z } from 'zod';
import { job } from '../../../core/define.js';
import { rollWeekly } from '../lib/meetings.js';
import { JOBS } from '../lib/schedule.js';
import { getSettings } from '../lib/settings.js';

const payloadSchema = z.object({ meetingId: z.number().int() });

// Runs when a weekly meeting starts and posts next week's copy, so RSVPs open a week ahead.
export default job({
  type: JOBS.meetingNext,
  async run(payload, { client, guildId }) {
    const { meetingId } = payloadSchema.parse(payload);
    if (!guildId) return;
    const { timezone } = await getSettings(guildId);
    await rollWeekly(client, meetingId, timezone);
  },
});
