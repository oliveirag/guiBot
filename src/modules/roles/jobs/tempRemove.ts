import { RESTJSONErrorCodes } from 'discord.js';
import { z } from 'zod';
import { job } from '../../../core/define.js';
import { JOB_TEMPROLE } from '../lib/autoroles.js';

const payloadSchema = z.object({ userId: z.string(), roleId: z.string() });

// Nothing to undo if they left or the role is gone.
const GONE = new Set<unknown>([RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownRole, RESTJSONErrorCodes.UnknownGuild]);

export default job({
  type: JOB_TEMPROLE,
  async run(payload, { client, guildId }) {
    const { userId, roleId } = payloadSchema.parse(payload);
    if (!guildId) return;
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Temp role ended');
    } catch (error) {
      if (GONE.has((error as { code?: unknown }).code)) return;
      throw error;
    }
  },
});
