import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { log } from '../../../core/log.js';
import { refresh } from '../lib/publish.js';
import { getSuggestion, review, type Verdict } from '../lib/suggestions.js';

const VERB: Record<Verdict, string> = { approved: 'approved', denied: 'denied', considered: 'marked as considering' };

const verdictSub = (name: string, verdict: Verdict, description: string) => (s: import('discord.js').SlashCommandSubcommandBuilder) =>
  s
    .setName(name)
    .setDescription(description)
    .addIntegerOption((o) => o.setName('number').setDescription('Suggestion number').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription(`Why it was ${VERB[verdict]}`).setMaxLength(500));

export default command({
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Make a call on a suggestion.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(verdictSub('approve', 'approved', 'Approve a suggestion. Voting closes.'))
    .addSubcommand(verdictSub('deny', 'denied', 'Deny a suggestion. Voting closes.'))
    .addSubcommand(verdictSub('consider', 'considered', "Mark a suggestion as being considered. Voting stays open.")),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageMessages,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const verdict: Verdict = sub === 'approve' ? 'approved' : sub === 'deny' ? 'denied' : 'considered';
    const s = await getSuggestion(interaction.guildId, interaction.options.getInteger('number', true));
    const reason = interaction.options.getString('reason');
    const updated = await review(s, verdict, interaction.user.id, reason);
    const redrawn = await refresh(interaction.client, updated);

    // Let the author know in the discussion thread (it shares the message's id) or by DM.
    const note = `Your suggestion #${s.number} was ${VERB[verdict]}${reason ? `: ${reason}` : '.'}`;
    const thread = await interaction.client.channels.fetch(s.messageId ?? '').catch(() => null);
    if (thread?.isThread()) {
      await thread.send({ content: `<@${s.authorId}> ${note}`, allowedMentions: { users: [s.authorId] } }).catch(() => {});
    } else {
      await interaction.client.users
        .send(s.authorId, `${note} (in ${interaction.guild.name})`)
        .catch((error) => log.info('suggestions: couldn’t DM author', (error as Error).message));
    }
    const missing = redrawn ? '' : " (I couldn't update the original post, it may be gone.)";
    await interaction.reply({ embeds: [ok(`Suggestion #${s.number} ${VERB[verdict]}.${missing}`)], flags: MessageFlags.Ephemeral });
  },
});
