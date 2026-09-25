import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { UserError } from '../../../core/errors.js';
import { DEFAULT_JOIN, DEFAULT_LEAVE, getWelcome, greeting, renderTemplate } from '../lib/greet.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Preview the welcome, leave, or DM message on yourself.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Show what the message looks like, only to you.')
        .addStringOption((o) =>
          o
            .setName('which')
            .setDescription('Default: join')
            .addChoices({ name: 'Join', value: 'join' }, { name: 'Leave', value: 'leave' }, { name: 'DM', value: 'dm' }),
        ),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const s = await getWelcome(interaction.guildId);
    const which = interaction.options.getString('which') ?? 'join';
    const member = interaction.member;
    const vars = {
      userId: member.id,
      username: member.user.username,
      server: interaction.guild.name,
      count: interaction.guild.memberCount,
    };

    let preview;
    if (which === 'dm') {
      if (!s?.dmMessage) throw new UserError('No DM message is set. Add one with `/config welcome dm`.');
      preview = { content: renderTemplate(s.dmMessage, vars) };
    } else if (which === 'leave') {
      if (!s?.leaveChannelId) throw new UserError('Leave messages are off. Turn them on with `/config welcome leave`.');
      preview = greeting(s.leaveMessage ?? DEFAULT_LEAVE, vars, s.leaveEmbed, member.displayAvatarURL());
    } else {
      if (!s?.joinChannelId) throw new UserError('Welcome messages are off. Turn them on with `/config welcome join`.');
      preview = greeting(s.joinMessage ?? DEFAULT_JOIN, vars, s.joinEmbed, member.displayAvatarURL());
    }
    await interaction.reply({ ...preview, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
  },
});
