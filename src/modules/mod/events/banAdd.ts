import { AuditLogEvent, Events, type GuildBan } from 'discord.js';
import { event } from '../../../core/define.js';
import { prisma } from '../../../db.js';
import { announce, botBans } from '../lib/act.js';
import { createCase, madeRecently } from '../lib/cases.js';

/** Who banned them and why, from the audit log. Needs View Audit Log; null without it. */
async function auditEntry(ban: GuildBan): Promise<{ executorId: string; reason: string | null } | null> {
  try {
    const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
    const entry = logs.entries.find((e) => e.targetId === ban.user.id);
    return entry?.executorId ? { executorId: entry.executorId, reason: entry.reason } : null;
  } catch {
    return null;
  }
}

// Bans done in Discord's UI (or by other bots) still get a case.
export default event({
  name: Events.GuildBanAdd,
  async run(ban: GuildBan) {
    const guildId = ban.guild.id;
    if (botBans.has(`${guildId}:${ban.user.id}`) || (await madeRecently(guildId, ban.user.id, 'ban'))) return;
    const entry = await auditEntry(ban);
    if (entry?.executorId === ban.client.user.id) return;
    // A newer ban replaces any temp ban still counting down.
    await prisma.modCase.updateMany({ where: { guildId, userId: ban.user.id, action: 'ban', active: true }, data: { active: false } });
    const c = await createCase({
      guildId,
      action: 'ban',
      userId: ban.user.id,
      userTag: ban.user.tag,
      moderatorId: entry?.executorId ?? ban.client.user.id,
      reason: entry?.reason ?? ban.reason ?? 'Banned outside guiBot',
    });
    await announce(ban.client, c);
  },
});
