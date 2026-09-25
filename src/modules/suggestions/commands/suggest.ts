import { ChannelType, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { sendTo } from '../../sd/lib/post.js';
import { createSuggestion, renderSuggestion } from '../lib/suggestions.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggest something for the server. People vote on it.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMinLength(5).setMaxLength(1500)),
  guildOnly: true,
  cooldownSeconds: 60,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const settings = await prisma.suggestionSettings.findUnique({ where: { guildId } });
    if (!settings?.channelId) throw new UserError("Suggestions aren't set up here. An admin can turn them on with `/config suggestions channel`.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const s = await createSuggestion({
      guildId,
      authorId: interaction.user.id,
      content: interaction.options.getString('idea', true),
      channelId: settings.channelId,
    });
    const author = { name: interaction.member.displayName, avatarUrl: interaction.member.displayAvatarURL() };
    const message = await sendTo(interaction.client, settings.channelId, renderSuggestion(s, { up: 0, down: 0 }, author));
    if (!message) {
      await prisma.suggestion.delete({ where: { id: s.id } });
      throw new UserError("I can't post in the suggestions channel. Tell an admin.");
    }
    await prisma.suggestion.update({ where: { id: s.id }, data: { messageId: message.id } });

    if (settings.threads && message.channel.type === ChannelType.GuildText) {
      await message
        .startThread({ name: `Suggestion #${s.number}`.slice(0, 100), autoArchiveDuration: 10080 })
        .catch((error) => log.warn('suggestions: thread failed', error));
    }
    await interaction.editReply({ embeds: [ok(`Posted suggestion #${s.number}: ${message.url}`)] });
  },
});
