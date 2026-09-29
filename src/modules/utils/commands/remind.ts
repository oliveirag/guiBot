import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { parseDuration } from '../../mod/lib/duration.js';
import { createReminder, deleteReminder, listReminders, reminderLine } from '../lib/reminders.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Reminders that ping you later.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Remind yourself about something.')
        .addStringOption((o) => o.setName('when').setDescription('In how long, like 10m, 2h, 3d, 1h30m').setRequired(true))
        .addStringOption((o) => o.setName('about').setDescription('What to remind you about').setRequired(true).setMaxLength(1000))
        .addBooleanOption((o) => o.setName('dm').setDescription('DM you instead of pinging here (default no)')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Your reminders in this server.'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Cancel a reminder.')
        .addIntegerOption((o) => o.setName('id').setDescription('Reminder number from /remind list').setRequired(true).setMinValue(1)),
    ),
  guildOnly: true,
  cooldownSeconds: 3,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const { guildId, user } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const reminders = await listReminders(guildId, user.id);
      const text = reminders.length > 0 ? reminders.map(reminderLine).join('\n') : 'Nothing coming up. Set one with `/remind set`.';
      await interaction.reply({ embeds: [info(text, 'Your reminders')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'delete') {
      const r = await deleteReminder(guildId, user.id, interaction.options.getInteger('id', true));
      await interaction.reply({ embeds: [ok(`Cancelled reminder #${r.id}.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const dm = interaction.options.getBoolean('dm') ?? false;
    if (!dm && !interaction.channel?.isSendable()) throw new UserError("I can't post here, so pick `dm: true`.");
    const r = await createReminder({
      guildId,
      channelId: interaction.channelId,
      userId: user.id,
      text: interaction.options.getString('about', true),
      dm,
      seconds: parseDuration(interaction.options.getString('when', true)),
    });
    const where = dm ? 'in your DMs' : 'here';
    await interaction.reply({
      embeds: [ok(`Got it. I'll remind you ${where} <t:${Math.floor(r.dueAt.getTime() / 1000)}:R>. (#${r.id})`)],
      flags: MessageFlags.Ephemeral,
    });
  },
});
