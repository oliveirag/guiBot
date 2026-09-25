import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { assertAssignable } from '../lib/assignable.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give, take, or look up roles.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give someone a role.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Take a role from someone.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Show details about a role.')
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageRoles,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const role = interaction.options.getRole('role', true);
    const sub = interaction.options.getSubcommand();

    if (sub === 'info') {
      const lines = [
        `**ID** ${role.id}`,
        `**Color** ${role.hexColor}`,
        `**Members** ${role.members.size}`,
        `**Position** ${role.position}`,
        `**Mentionable** ${role.mentionable ? 'yes' : 'no'} · **Shown separately** ${role.hoist ? 'yes' : 'no'}`,
        `**Created** <t:${Math.floor(role.createdTimestamp / 1000)}:D>`,
      ];
      const embed = info(lines.join('\n'), role.name);
      if (role.color) embed.setColor(role.color);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await assertAssignable(interaction, role);
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new UserError("They're not in this server.");
    const reason = `${interaction.user.username}: /role ${sub}`;
    if (sub === 'add') {
      if (member.roles.cache.has(role.id)) throw new UserError(`They already have ${role}.`);
      await member.roles.add(role, reason);
      await interaction.reply({ embeds: [ok(`Gave ${member} ${role}.`)], allowedMentions: { parse: [] } });
    } else {
      if (!member.roles.cache.has(role.id)) throw new UserError(`They don't have ${role}.`);
      await member.roles.remove(role, reason);
      await interaction.reply({ embeds: [ok(`Took ${role} from ${member}.`)], allowedMentions: { parse: [] } });
    }
  },
});
