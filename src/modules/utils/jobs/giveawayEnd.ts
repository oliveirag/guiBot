import { z } from 'zod';
import { job } from '../../../core/define.js';
import { JOB_GIVEAWAY_END, finishGiveaway } from '../lib/giveaways.js';

const payloadSchema = z.object({ giveawayId: z.number() });

export default job({
  type: JOB_GIVEAWAY_END,
  async run(payload, { client }) {
    await finishGiveaway(client, payloadSchema.parse(payload).giveawayId);
  },
});
