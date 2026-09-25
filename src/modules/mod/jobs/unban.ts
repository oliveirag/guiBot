import { RESTJSONErrorCodes } from 'discord.js';
import { z } from 'zod';
import { job } from '../../../core/define.js';
import { prisma } from '../../../db.js';
import { JOB_UNBAN, announce } from '../lib/act.js';
import { createCase } from '../lib/cases.js';

const payloadSchema = z.object({ caseId: z.number().int() });

export default job({
  type: JOB_UNBAN,
  async run(payload, { client }) {
    const { caseId } = payloadSchema.parse(payload);
    const ban = await prisma.modCase.findUnique({ where: { id: caseId } });
    // Already unbanned by hand, or replaced by a newer ban.
    if (!ban || !ban.active) return;

    const guild = await client.guilds.fetch(ban.guildId);
    // Only mark it done once Discord agrees, so a failed attempt is retried instead of skipped.
    const done = () => prisma.modCase.update({ where: { id: ban.id }, data: { active: false } });
    try {
      await guild.bans.remove(ban.userId, `Temp ban from case #${ban.number} ended`);
    } catch (error) {
      if ((error as { code?: unknown }).code === RESTJSONErrorCodes.UnknownBan) {
        await done();
        return;
      }
      throw error;
    }
    await done();
    const c = await createCase({
      guildId: ban.guildId,
      action: 'unban',
      userId: ban.userId,
      userTag: ban.userTag,
      moderatorId: client.user?.id ?? ban.moderatorId,
      reason: `Temp ban from case #${ban.number} ended`,
    });
    await announce(client, c);
  },
});
