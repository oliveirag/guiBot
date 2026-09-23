import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { addDeadline, listOpen, markDone, refreshBoard, renderBoard } from '../lib/deadlines.js';
import { getSettings } from '../lib/settings.js';
import { parseClock, parseDate, stamp, zonedTime } from '../lib/time.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('deadline')
    .setDescription('Track Senior Design deadlines.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a deadline. Reminders go out 7, 2, and 1 day before.')
        .addStringOption((o) => o.setName('title').setDescription('What is due').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('date').setDescription('Like 2026-10-05 or 10/5').setRequired(true))
        .addStringOption((o) => o.setName('time').setDescription('Like 11:59pm (default 23:59)')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show open deadlines.'))
    .addSubcommand((s) =>
      s
        .setName('done')
        .setDescription('Mark a deadline done.')
        .addIntegerOption((o) => o.setName('id').setDescription('The #number from /deadline list').setRequired(true)),
    ),
  guildOnly: true,

  async run({ interaction }) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const now = new Date();

    if (sub === 'list') {
      await interaction.reply({ embeds: [renderBoard(await listOpen(guildId), now)], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'done') {
      const deadline = await markDone(guildId, interaction.options.getInteger('id', true), now);
      await interaction.reply({ embeds: [ok(`**${deadline.title}** is done.`)] });
      await refreshBoard(interaction.client, guildId, now);
      return;
    }

    const { timezone, deadlineChannelId } = await getSettings(guildId);
    const date = parseDate(interaction.options.getString('date', true), now, timezone);
    const clock = parseClock(interaction.options.getString('time') ?? '23:59');
    const { deadline, reminders } = await addDeadline(
      guildId,
      interaction.options.getString('title', true),
      zonedTime(date, clock, timezone),
      interaction.user.id,
      now,
    );
    let heads = '';
    if (!deadlineChannelId) heads = ' Set `/config sd deadlines` to get reminders.';
    else if (reminders > 0) heads = ` ${reminders} reminder${reminders === 1 ? '' : 's'} queued.`;
    await interaction.reply({
      embeds: [ok(`\`#${deadline.id}\` **${deadline.title}** is due ${stamp(deadline.dueAt, 'f')}.${heads}`)],
    });
    await refreshBoard(interaction.client, guildId, now);
  },
});
