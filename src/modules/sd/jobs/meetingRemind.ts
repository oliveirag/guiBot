import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { remindMeeting } from '../lib/meetings.js';
import { JOBS } from '../lib/schedule.js';

const payloadSchema = z.object({ meetingId: z.number().int(), minutes: z.number().int(), startsAt: z.string() });

export default job({
  type: JOBS.meetingRemind,
  async run(payload, { client, guildId }) {
    const parsed = payloadSchema.parse(payload);
    if (guildId && !(await isModuleEnabled(guildId, 'sd'))) return;
    await remindMeeting(client, parsed);
  },
});
