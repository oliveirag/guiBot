import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { everyoneCanSend, isLockable, setLocked } from '../lib/channels.js';
import { getModSettings, updateModSettings } from '../lib/settings.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock every channel @everyone can talk in, or undo it.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName('on')
        .setDescription('Lock the server down.')
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(300)),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Unlock the channels the last lockdown locked.')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageChannels,
  cooldownSeconds: 10,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guild = interaction.guild;
    const everyone = guild.roles.everyone;
    const settings = await getModSettings(guild.id);
    const already = settings.lockedChannels.split(',').filter(Boolean);
    await interaction.deferReply();

    if (interaction.options.getSubcommand() === 'on') {
      if (already.length > 0) throw new UserError('Already in lockdown. `/lockdown off` first.');
      const reason = `${interaction.user.username}: lockdown${interaction.options.getString('reason') ? `, ${interaction.options.getString('reason')}` : ''}`;
      const locked: string[] = [];
      for (const channel of guild.channels.cache.values()) {
        if (!isLockable(channel) || channel.isThread() || !everyoneCanSend(channel, everyone)) continue;
        try {
          await setLocked(channel, everyone, true, reason);
          locked.push(channel.id);
        } catch (error) {
          log.warn(`mod: lockdown skipped ${channel.id}`, error);
        }
      }
      await updateModSettings(guild.id, { lockedChannels: locked.join(',') });
      await interaction.editReply({ embeds: [ok(`🔒 Lockdown on. Locked ${locked.length} channel${locked.length === 1 ? '' : 's'}.`)] });
      return;
    }

    if (already.length === 0) throw new UserError("There's no lockdown to undo.");
    let unlocked = 0;
    for (const id of already) {
      const channel = guild.channels.cache.get(id);
      if (!channel || !isLockable(channel)) continue;
      try {
        await setLocked(channel, everyone, false, `${interaction.user.username}: lockdown over`);
        unlocked++;
      } catch (error) {
        log.warn(`mod: couldn't unlock ${id}`, error);
      }
    }
    await updateModSettings(guild.id, { lockedChannels: '' });
    await interaction.editReply({ embeds: [ok(`🔓 Lockdown off. Unlocked ${unlocked} channel${unlocked === 1 ? '' : 's'}.`)] });
  },
});
