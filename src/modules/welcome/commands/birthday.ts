import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { DEFAULT_TIMEZONE } from '../../sd/lib/time.js';
import { formatBirthday, parseBirthday, sortUpcoming } from '../lib/birthdays.js';
import { getWelcome } from '../lib/greet.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Save your birthday so the server celebrates it.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Save your birthday (no year needed).')
        .addStringOption((o) => o.setName('date').setDescription('Like 10/5 or Oct 5').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Forget your birthday.'))
    .addSubcommand((s) => s.setName('list').setDescription('Upcoming birthdays.')),
  guildOnly: true,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    switch (interaction.options.getSubcommand()) {
      case 'set': {
        const date = parseBirthday(interaction.options.getString('date', true));
        await prisma.birthday.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, ...date },
          update: date,
        });
        const s = await getWelcome(guildId);
        const heads = s?.birthdayChannelId ? '' : " (Birthday posts aren't on here yet. An admin can turn them on.)";
        await interaction.reply({ embeds: [ok(`Got it: ${formatBirthday(date)}.${heads}`)], flags: MessageFlags.Ephemeral });
        return;
      }
      case 'remove': {
        const { count } = await prisma.birthday.deleteMany({ where: { guildId, userId } });
        if (count === 0) throw new UserError("I didn't have your birthday saved.");
        await interaction.reply({ embeds: [ok('Forgot your birthday.')], flags: MessageFlags.Ephemeral });
        return;
      }
      default: {
        const rows = await prisma.birthday.findMany({ where: { guildId } });
        const tz = (await getWelcome(guildId))?.timezone ?? DEFAULT_TIMEZONE;
        const upcoming = sortUpcoming(rows, new Date(), tz).slice(0, 15);
        const body = upcoming.length
          ? upcoming.map((b) => `**${formatBirthday(b)}** <@${b.userId}>`).join('\n')
          : 'Nobody yet. Add yours with `/birthday set`.';
        await interaction.reply({ embeds: [info(body, 'Upcoming birthdays')], flags: MessageFlags.Ephemeral });
      }
    }
  },
});
