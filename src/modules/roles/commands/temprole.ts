import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { formatDuration, parseDuration } from '../../mod/lib/duration.js';
import { assertAssignable } from '../lib/assignable.js';
import { JOB_TEMPROLE } from '../lib/autoroles.js';

const MAX_TEMPROLE = 365 * 86_400;

export default command({
  data: new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Give someone a role that comes off by itself later.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Like 1h, 3d, 2w').setRequired(true)),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageRoles,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const role = interaction.options.getRole('role', true);
    await assertAssignable(interaction, role);
    const seconds = parseDuration(interaction.options.getString('duration', true));
    if (seconds > MAX_TEMPROLE) throw new UserError('Temp roles max out at a year.');
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new UserError("They're not in this server.");

    await member.roles.add(role, `${interaction.user.username}: temp role for ${formatDuration(seconds)}`);
    const until = new Date(Date.now() + seconds * 1000);
    await scheduleJob(JOB_TEMPROLE, until, { userId: user.id, roleId: role.id }, interaction.guildId);
    await interaction.reply({
      embeds: [ok(`Gave ${member} ${role} until <t:${Math.floor(until.getTime() / 1000)}:f>.`)],
      allowedMentions: { parse: [] },
    });
  },
});
