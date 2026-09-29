import { z } from 'zod';
import { job } from '../../../core/define.js';
import { JOB_REMIND, deliverReminder } from '../lib/reminders.js';

const payloadSchema = z.object({ reminderId: z.number() });

export default job({
  type: JOB_REMIND,
  async run(payload, { client }) {
    await deliverReminder(client, payloadSchema.parse(payload).reminderId);
  },
});
