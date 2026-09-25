import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Client } from 'discord.js';
import { command } from '../../../core/define.js';
import { info, ok } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import { canPost } from '../../dev/lib/feeds.js';
import { editIn, sendTo } from '../../sd/lib/post.js';
import { assertAssignable, parseEmoji } from '../lib/assignable.js';
import { addOption, createPanel, getPanel, removeOption, renderPanel, type PanelWithOptions } from '../lib/panels.js';

/** Edits the panel message in place, or reposts it if the old one is gone. */
async function publish(client: Client, panel: PanelWithOptions): Promise<void> {
  const view = renderPanel(panel);
  if (panel.messageId && (await editIn(client, panel.channelId, panel.messageId, view))) return;
  const message = await sendTo(client, panel.channelId, view);
  if (!message) throw new UserError(`I can't post in <#${panel.channelId}> anymore.`);
  await prisma.rolePanel.update({ where: { id: panel.id }, data: { messageId: message.id } });
}

const panelOption = (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName('panel').setDescription('Panel number (see /rolepanel list)').setRequired(true).setMinValue(1);

export default command({
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Button or dropdown panels people use to pick their own roles.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Post a new, empty panel.')
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('description').setDescription('Text under the title').setMaxLength(1000))
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('Buttons (default) or a dropdown')
            .addChoices({ name: 'Buttons', value: 'buttons' }, { name: 'Dropdown', value: 'select' }),
        )
        .addBooleanOption((o) => o.setName('one-only').setDescription('People can hold just one role from it, like colors (default no)'))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Default: this one').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a role to a panel (or update its label and emoji).')
        .addIntegerOption(panelOption)
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('Button text (default: role name)').setMaxLength(80))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Take a role off a panel.')
        .addIntegerOption(panelOption)
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('one-only')
        .setDescription('Let people hold just one role from a panel, or any number.')
        .addIntegerOption(panelOption)
        .addBooleanOption((o) => o.setName('enabled').setDescription('One role only').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('delete').setDescription('Delete a panel and its message.').addIntegerOption(panelOption),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show this server’s panels.')),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageRoles,

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'create': {
        const channel = interaction.options.getChannel('channel', false, [ChannelType.GuildText, ChannelType.GuildAnnouncement]) ?? interaction.channel;
        if (!channel || channel.isThread() || !('permissionsFor' in channel)) throw new UserError('Pick a text channel.');
        if (!canPost(channel.permissionsFor(interaction.client.user))) {
          throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links.`);
        }
        const panel = await createPanel({
          guildId,
          channelId: channel.id,
          title: interaction.options.getString('title', true),
          description: interaction.options.getString('description'),
          style: (interaction.options.getString('style') ?? 'buttons') as 'buttons' | 'select',
          exclusive: interaction.options.getBoolean('one-only') ?? false,
        });
        await publish(interaction.client, panel);
        await reply(`Panel #${panel.id} is up in ${channel}. Add roles with \`/rolepanel add panel:${panel.id}\`.`);
        return;
      }
      case 'add': {
        const panel = await getPanel(guildId, interaction.options.getInteger('panel', true));
        const role = interaction.options.getRole('role', true);
        await assertAssignable(interaction, role);
        const rawEmoji = interaction.options.getString('emoji');
        const emoji = rawEmoji ? parseEmoji(rawEmoji).key : null;
        const updated = await addOption(panel, role.id, interaction.options.getString('label') ?? role.name, emoji);
        await publish(interaction.client, updated);
        await reply(`${role} is on panel #${panel.id}.`);
        return;
      }
      case 'remove': {
        const panel = await getPanel(guildId, interaction.options.getInteger('panel', true));
        const role = interaction.options.getRole('role', true);
        await publish(interaction.client, await removeOption(panel, role.id));
        await reply(`${role} is off panel #${panel.id}.`);
        return;
      }
      case 'one-only': {
        const panel = await getPanel(guildId, interaction.options.getInteger('panel', true));
        const exclusive = interaction.options.getBoolean('enabled', true);
        await prisma.rolePanel.update({ where: { id: panel.id }, data: { exclusive } });
        await publish(interaction.client, { ...panel, exclusive });
        await reply(
          exclusive
            ? `Panel #${panel.id} is one role only now. People who already hold several keep them until they click.`
            : `Panel #${panel.id} lets people pick any number of roles.`,
        );
        return;
      }
      case 'delete': {
        const panel = await getPanel(guildId, interaction.options.getInteger('panel', true));
        await prisma.rolePanel.delete({ where: { id: panel.id } });
        if (panel.messageId) {
          const channel = await interaction.client.channels.fetch(panel.channelId).catch(() => null);
          if (channel?.isTextBased()) await channel.messages.delete(panel.messageId).catch(() => {});
        }
        await reply(`Deleted panel #${panel.id}.`);
        return;
      }
      default: {
        const panels = await prisma.rolePanel.findMany({ where: { guildId }, include: { _count: { select: { options: true } } } });
        const body = panels.length
          ? panels.map((p) => `\`#${p.id}\` **${p.title}** · <#${p.channelId}> · ${p._count.options} roles · ${p.style}${p.exclusive ? ' · one only' : ''}`).join('\n')
          : 'No panels yet. Make one with `/rolepanel create`.';
        await interaction.reply({ embeds: [info(body, 'Role panels')], flags: MessageFlags.Ephemeral });
      }
    }
  },
});
