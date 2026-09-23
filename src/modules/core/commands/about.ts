import { readFileSync } from 'node:fs';
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';
import { formatUptime } from '../lib/format.js';

const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { version: string };

export default command({
  data: new SlashCommandBuilder().setName('about').setDescription('What guiBot is and what it runs.'),
  async run({ interaction, registry }) {
    const embed = info(
      "Gui's personal everything bot. Moderation, levels, team tracking, and whatever gets added next.",
      'guiBot',
    ).addFields(
      { name: 'Version', value: pkg.version, inline: true },
      { name: 'Modules', value: String(registry.modules.length), inline: true },
      { name: 'Commands', value: String(registry.commands.size), inline: true },
      { name: 'Uptime', value: formatUptime(process.uptime()), inline: true },
    );
    await interaction.reply({ embeds: [embed] });
  },
});
