import { MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { assertAssignable } from './lib/assignable.js';
import { MAX_AUTOROLES, type AutoTarget } from './lib/autoroles.js';

const TARGETS = [
  { name: 'People', value: 'humans' },
  { name: 'Bots', value: 'bots' },
];

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('autorole-add')
          .setDescription('Give a role to everyone who joins.')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
          .addStringOption((o) => o.setName('for').setDescription('People (default) or bots').addChoices(...TARGETS)),
      )
      .addSubcommand((s) =>
        s
          .setName('autorole-remove')
          .setDescription('Stop giving a role on join.')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
          .addStringOption((o) => o.setName('for').setDescription('People (default) or bots').addChoices(...TARGETS)),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Show autoroles.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'show') {
      const rows = await prisma.autoRole.findMany({ where: { guildId } });
      const list = (t: AutoTarget) => rows.filter((r) => r.target === t).map((r) => `<@&${r.roleId}>`).join(' ') || 'none';
      await interaction.reply({
        embeds: [info(`**People** ${list('humans')}\n**Bots** ${list('bots')}`, 'Autoroles')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole('role', true);
    const target = (interaction.options.getString('for') ?? 'humans') as AutoTarget;
    if (sub === 'autorole-add') {
      await assertAssignable(interaction, role);
      if ((await prisma.autoRole.count({ where: { guildId } })) >= MAX_AUTOROLES) {
        throw new UserError(`At most ${MAX_AUTOROLES} autoroles.`);
      }
      await prisma.autoRole.upsert({
        where: { guildId_roleId_target: { guildId, roleId: role.id, target } },
        create: { guildId, roleId: role.id, target },
        update: {},
      });
      await interaction.reply({ embeds: [ok(`New ${target === 'bots' ? 'bots' : 'members'} get ${role}.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    const { count } = await prisma.autoRole.deleteMany({ where: { guildId, roleId: role.id, target } });
    if (count === 0) throw new UserError(`${role} isn't an autorole for ${target}.`);
    await interaction.reply({ embeds: [ok(`${role} is no longer given on join.`)], flags: MessageFlags.Ephemeral });
  },

  async view(guildId) {
    const count = await prisma.autoRole.count({ where: { guildId } });
    const panels = await prisma.rolePanel.count({ where: { guildId } });
    return `${panels} panel${panels === 1 ? '' : 's'} · ${count} autorole${count === 1 ? '' : 's'}`;
  },
});
