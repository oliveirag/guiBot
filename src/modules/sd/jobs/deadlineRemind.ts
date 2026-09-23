import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { prisma } from '../../../db.js';
import { refreshBoard, renderReminder } from '../lib/deadlines.js';
import { sendTo } from '../lib/post.js';
import { JOBS } from '../lib/schedule.js';
import { getSettings } from '../lib/settings.js';

const payloadSchema = z.object({ deadlineId: z.number().int(), days: z.number().int(), dueAt: z.string() });

export default job({
  type: JOBS.deadlineRemind,
  async run(payload, { client }) {
    const { deadlineId, days, dueAt } = payloadSchema.parse(payload);
    const deadline = await prisma.sdDeadline.findUnique({ where: { id: deadlineId } });
    if (!deadline || deadline.doneAt || deadline.dueAt.toISOString() !== dueAt) return;
    if (!(await isModuleEnabled(deadline.guildId, 'sd'))) return;
    const { deadlineChannelId } = await getSettings(deadline.guildId);
    if (!deadlineChannelId) return;
    await sendTo(client, deadlineChannelId, { embeds: [renderReminder(deadline, days)] });
    await refreshBoard(client, deadline.guildId);
  },
});
