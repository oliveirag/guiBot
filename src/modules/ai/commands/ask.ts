import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { UserError } from '../../../core/errors.js';
import { log } from '../../../core/log.js';
import { createGemini } from '../lib/gemini.js';
import { fetchHistory } from '../lib/history.js';
import { answer, checkGate, failureMessage, forDiscord } from '../lib/reply.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask guiBot something. It sees the last few messages here.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('question').setDescription('What you want to know').setRequired(true).setMaxLength(1000)),
  guildOnly: true,

  async run({ interaction, env }) {
    if (!interaction.inCachedGuild() || !interaction.channel) return;
    if (!env.gemini) throw new UserError("AI isn't set up. Add GEMINI_API_KEY.");
    const channel = interaction.channel;
    const toggleId = channel.isThread() ? (channel.parentId ?? channel.id) : channel.id;

    const gate = await checkGate(interaction.guildId, toggleId, interaction.user.id, env.ownerIds);
    if (!gate.allowed && gate.reason === 'off') {
      throw new UserError('AI is off in this channel. An admin can turn it on with `/config ai channel`.');
    }
    if (!gate.allowed) throw new UserError(`Slow down. Try again in ${gate.left}s.`);

    const question = interaction.options.getString('question', true);
    await interaction.deferReply();
    let text: string;
    try {
      text = await answer({
        guildId: interaction.guildId,
        jira: env.jira,
        generate: createGemini(env.gemini),
        history: await fetchHistory(channel, interaction.client.user.id),
        asker: interaction.member.displayName,
        question,
      });
    } catch (error) {
      log.warn('ai: /ask failed', error);
      throw new UserError(failureMessage(error));
    }
    const quoted = question.replace(/\s+/g, ' ').slice(0, 200);
    await interaction.editReply({ content: forDiscord(`> ${quoted}\n${text}`), allowedMentions: { parse: [] } });
  },
});
