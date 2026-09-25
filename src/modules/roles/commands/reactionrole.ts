import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { assertAssignable, parseEmoji } from '../lib/assignable.js';
import { MAX_REACTION_ROLES, parseMessageLink } from '../lib/reactions.js';

const linkOption = (o: import('discord.js').SlashCommandStringOption) =>
  o.setName('message').setDescription('Message link (right click › Copy Message Link)').setRequired(true);

export default command({
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Give a role when people react to a message.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Map an emoji on a message to a role.')
        .addStringOption(linkOption)
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an emoji mapping.')
        .addStringOption(linkOption)
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show reaction roles.')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageRoles,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await prisma.reactionRole.findMany({ where: { guildId }, take: 50 });
      const body = rows.length
        ? rows
            .map((r) => {
              const emoji = /^\d+$/.test(r.emoji) ? `<:e:${r.emoji}>` : r.emoji;
              return `${emoji} → <@&${r.roleId}> · [message](https://discord.com/channels/${guildId}/${r.channelId}/${r.messageId})`;
            })
            .join('\n')
        : 'None yet.';
      await interaction.reply({ embeds: [info(body, 'Reaction roles')], flags: MessageFlags.Ephemeral });
      return;
    }

    const link = parseMessageLink(interaction.options.getString('message', true));
    if (!link || link.guildId !== guildId) throw new UserError('Paste a message link from this server.');
    const emoji = parseEmoji(interaction.options.getString('emoji', true));

    if (sub === 'remove') {
      const { count } = await prisma.reactionRole.deleteMany({ where: { messageId: link.messageId, emoji: emoji.key } });
      if (count === 0) throw new UserError("That emoji isn't mapped on that message.");
      await interaction.reply({ embeds: [ok(`Removed ${emoji.display} from that message.`)], flags: MessageFlags.Ephemeral });
      return;
    }

    const role = interaction.options.getRole('role', true);
    await assertAssignable(interaction, role);
    if ((await prisma.reactionRole.count({ where: { guildId } })) >= MAX_REACTION_ROLES) {
      throw new UserError(`This server has ${MAX_REACTION_ROLES} reaction roles already.`);
    }
    const channel = await interaction.client.channels.fetch(link.channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserError("I can't see that channel.");
    const message = await channel.messages.fetch(link.messageId).catch(() => null);
    if (!message) throw new UserError("I can't find that message.");
    try {
      await message.react(emoji.display);
    } catch {
      throw new UserError(`I couldn't react with ${emoji.display}. If it's a custom emoji, it has to be from a server I'm in.`);
    }
    await prisma.reactionRole.upsert({
      where: { messageId_emoji: { messageId: link.messageId, emoji: emoji.key } },
      create: { guildId, channelId: link.channelId, messageId: link.messageId, emoji: emoji.key, roleId: role.id },
      update: { roleId: role.id },
    });
    await interaction.reply({ embeds: [ok(`Reacting with ${emoji.display} on that message gives ${role}.`)], flags: MessageFlags.Ephemeral });
  },
});
