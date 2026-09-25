import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { log } from '../../../core/log.js';
import { editIn } from '../../sd/lib/post.js';
import { caseLine, editReason, getCase, renderCase, userCases } from '../lib/cases.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('modlog')
    .setDescription('Look up or fix moderation cases.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('case')
        .setDescription('Show one case.')
        .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription("Change a case's reason.")
        .addIntegerOption((o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(400)),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("Show someone's cases.")
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ModerateMembers,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'history') {
      const user = interaction.options.getUser('user', true);
      const cases = await userCases(guildId, user.id);
      const body = cases.length > 0 ? cases.map(caseLine).join('\n') : 'No cases.';
      await interaction.reply({ embeds: [info(body.slice(0, 4096), `Cases for ${user.tag}`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const number = interaction.options.getInteger('number', true);
    if (sub === 'case') {
      await interaction.reply({ embeds: [renderCase(await getCase(guildId, number))], flags: MessageFlags.Ephemeral });
      return;
    }

    const c = await editReason(guildId, number, interaction.options.getString('reason', true));
    if (c.logChannelId && c.logMessageId) {
      await editIn(interaction.client, c.logChannelId, c.logMessageId, { embeds: [renderCase(c)] }).catch((error) =>
        log.warn(`mod: couldn't update the log for case #${c.number}`, error),
      );
    }
    await interaction.reply({ embeds: [ok(`Updated case #${c.number}.`)], flags: MessageFlags.Ephemeral });
  },
});
