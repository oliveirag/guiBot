import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { activeSprint } from '../lib/jiraApi.js';
import { renderSprint } from '../lib/sprint.js';
import { feedKeys } from '../lib/stats.js';
import { byJiraAccount, listMembers } from '../lib/team.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('sprint')
    .setDescription("Show the active Jira sprint: what's to do, in progress, and done.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('project').setDescription('Jira project key (default the one in /config dev)')),
  guildOnly: true,
  cooldownSeconds: 10,

  async run({ interaction, env }) {
    if (!interaction.inGuild()) return;
    if (!env.jira) {
      throw new UserError("Jira API access isn't set up. Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.");
    }
    const guildId = interaction.guildId;

    let project = interaction.options.getString('project')?.trim().toUpperCase();
    if (!project) {
      const { jira } = await feedKeys(guildId);
      if (jira.length === 0) throw new UserError('Pass `project`, or add a Jira feed with `/config dev add`.');
      if (jira.length > 1) throw new UserError(`This server follows ${jira.join(', ')}. Pick one with \`project\`.`);
      project = jira[0]!;
    }
    if (!/^[A-Z][A-Z0-9_]+$/.test(project)) throw new UserError('Use the Jira project key, like SD.');

    await interaction.deferReply();
    const sprint = await activeSprint(env.jira, project);
    if (!sprint) {
      await interaction.editReply({ embeds: [info(`${project} has no active sprint right now.`)] });
      return;
    }
    const assignees = byJiraAccount(await listMembers(guildId));
    await interaction.editReply({
      embeds: [renderSprint(sprint, project, env.jira.baseUrl, assignees)],
      allowedMentions: { parse: [] },
    });
  },
});
