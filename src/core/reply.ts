import { MessageFlags, type ChatInputCommandInteraction, type EmbedBuilder } from 'discord.js';

export type Repliable = Pick<ChatInputCommandInteraction, 'reply' | 'followUp' | 'editReply' | 'replied' | 'deferred'>;

/** Sends an embed whether or not the interaction was already answered or deferred. */
export async function respond(interaction: Repliable, embed: EmbedBuilder, ephemeral = true): Promise<void> {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({ embeds: [embed], flags });
  } else {
    await interaction.reply({ embeds: [embed], flags });
  }
}
