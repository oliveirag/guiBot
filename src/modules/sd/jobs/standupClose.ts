import { z } from 'zod';
import { job } from '../../../core/define.js';
import { JOBS } from '../lib/schedule.js';
import { closeStandup } from '../lib/standups.js';

const payloadSchema = z.object({ standupId: z.number().int() });

export default job({
  type: JOBS.standupClose,
  async run(payload, { client }) {
    const { standupId } = payloadSchema.parse(payload);
    await closeStandup(client, standupId);
  },
});
