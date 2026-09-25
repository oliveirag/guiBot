import { z } from 'zod';
import { job } from '../../../core/define.js';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { log } from '../../../core/log.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { JOB_TEMPROLE } from '../../roles/lib/autoroles.js';
import { sendTo } from '../../sd/lib/post.js';
import { localParts } from '../../sd/lib/time.js';
import { JOB_BIRTHDAYS, birthdaysOn, scheduleNextBirthdays } from '../lib/birthdays.js';
import { getWelcome } from '../lib/greet.js';

const payloadSchema = z.object({ version: z.number().int() });
const DAY_MS = 86_400_000;

export default job({
  type: JOB_BIRTHDAYS,
  async run(payload, { client, guildId }) {
    const { version } = payloadSchema.parse(payload);
    if (!guildId) return;
    const s = await getWelcome(guildId);
    if (!s?.birthdayChannelId || s.birthdayVersion !== version) return;
    const now = new Date();
    await scheduleNextBirthdays(s, now);
    if (!(await isModuleEnabled(guildId, 'welcome'))) return;

    const today = localParts(now, s.timezone);
    const guild = await client.guilds.fetch(guildId);
    const people = [];
    for (const b of await birthdaysOn(guildId, today)) {
      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (member) people.push(member);
    }
    if (people.length === 0) return;

    const mentions = people.map((m) => `<@${m.id}>`);
    const list = mentions.length === 1 ? mentions[0] : `${mentions.slice(0, -1).join(', ')} and ${mentions.at(-1)}`;
    await sendTo(client, s.birthdayChannelId, {
      content: `🎂 Happy birthday ${list}!`,
      allowedMentions: { users: people.map((m) => m.id) },
    });

    if (!s.birthdayRoleId) return;
    for (const member of people) {
      try {
        await member.roles.add(s.birthdayRoleId, 'Birthday');
        await scheduleJob(JOB_TEMPROLE, new Date(now.getTime() + DAY_MS), { userId: member.id, roleId: s.birthdayRoleId }, guildId);
      } catch (error) {
        log.warn(`welcome: couldn't give the birthday role in ${guildId}`, error);
      }
    }
  },
});
