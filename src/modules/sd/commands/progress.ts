import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { prisma } from '../../../db.js';
import { activity, emptyStats, renderMemberProgress, renderTeamProgress, standupRecords } from '../lib/stats.js';
import { listMembers } from '../lib/team.js';

const DAY_MS = 86_400_000;

export default command({
  data: new SlashCommandBuilder()
    .setName('progress')
    .setDescription('Commits, PRs, reviews, Jira issues, and standups for someone or the whole team.')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('member').setDescription('Just this person (default everyone)'))
    .addIntegerOption((o) =>
      o.setName('days').setDescription('How far back (default 14)').setMinValue(1).setMaxValue(120),
    ),
  guildOnly: true,
  cooldownSeconds: 5,

  async run({ interaction }) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const days = interaction.options.getInteger('days') ?? 14;
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const user = interaction.options.getUser('member');

    if (user) {
      const member = await prisma.sdMember.findUnique({ where: { guildId_userId: { guildId, userId: user.id } } });
      const act = await activity(guildId, member ? [member] : [], since, now);
      const standup = (await standupRecords(guildId, [user.id], since)).get(user.id)!;
      await interaction.reply({
        embeds: [renderMemberProgress(member, user.id, act.byMember.get(user.id) ?? emptyStats(), standup, days)],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const members = await listMembers(guildId);
    const act = await activity(guildId, members, since, now);
    const standups = await standupRecords(
      guildId,
      members.map((m) => m.userId),
      since,
    );
    await interaction.reply({
      embeds: [renderTeamProgress(members, act, standups, days)],
      allowedMentions: { parse: [] },
    });
  },
});
