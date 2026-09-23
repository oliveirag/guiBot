import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { findAccountId } from '../lib/jiraApi.js';
import {
  describeMember,
  describeTeam,
  linkMember,
  listMembers,
  normalizeGithubLogin,
  parseJiraIdentity,
  unlinkMember,
  type LinkPatch,
} from '../lib/team.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Who is on the Senior Design team and their GitHub/Jira accounts.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('link')
        .setDescription('Link your GitHub and Jira so your work counts toward stats.')
        .addStringOption((o) => o.setName('github').setDescription('GitHub username'))
        .addStringOption((o) => o.setName('jira').setDescription('Jira login email (or your Jira profile link)'))
        .addUserOption((o) => o.setName('member').setDescription('Link someone else (managers only)')),
    )
    .addSubcommand((s) =>
      s
        .setName('unlink')
        .setDescription('Take someone off the team.')
        .addUserOption((o) => o.setName('member').setDescription('Who (default you)')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show the team.')),
  guildOnly: true,

  async run({ interaction, env }) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const members = await listMembers(guildId);
      await interaction.reply({
        embeds: [info(describeTeam(members), `Team (${members.length})`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const target = interaction.options.getUser('member') ?? interaction.user;
    if (target.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new UserError('You need Manage Server to change someone else.');
    }

    if (sub === 'unlink') {
      await unlinkMember(guildId, target.id);
      await interaction.reply({ embeds: [ok(`${target} is off the team.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const github = interaction.options.getString('github');
    const jira = interaction.options.getString('jira');
    if (!github && !jira) throw new UserError('Give me a GitHub username, a Jira email, or both.');

    const patch: LinkPatch = {};
    if (github) patch.githubLogin = normalizeGithubLogin(github);
    let note = '';
    if (jira) {
      const identity = parseJiraIdentity(jira);
      if ('jiraAccountId' in identity) {
        patch.jiraAccountId = identity.jiraAccountId;
        patch.jiraEmail = null;
      } else {
        patch.jiraEmail = identity.jiraEmail;
        patch.jiraAccountId = null;
        if (env.jira) {
          // The lookup can outlast Discord's 3 second reply window.
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          try {
            patch.jiraAccountId = await findAccountId(env.jira, identity.jiraEmail);
          } catch (error) {
            if (error instanceof UserError) throw error;
            log.warn('sd: Jira user lookup failed', error);
          }
        }
        if (!patch.jiraAccountId) {
          note = env.jira
            ? "\nJira didn't match that email to exactly one person. Paste your Jira profile link in `jira` instead."
            : "\nI can't look emails up in Jira yet, so paste your Jira profile link in `jira` for Jira stats.";
        }
      }
    }

    const member = await linkMember(guildId, target.id, patch);
    const embed = ok(`Linked. ${describeMember(member)}${note}`);
    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  },
});
