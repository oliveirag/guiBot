import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { formatDuration, parseDuration } from '../mod/lib/duration.js';
import { MAX_TIMEOUT_SECONDS } from '../mod/lib/checks.js';
import { ACTIONS, RULES, RULE_INFO, type RuleAction, type RuleName } from './lib/engine.js';
import { MAX_DOMAINS, MAX_WORDS, allRules, editList, getAutomod, setRule } from './lib/settings.js';

const splitItems = (raw: string): string[] =>
  raw
    .split(',')
    .map((w) => w.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);

function normalizeDomain(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new UserError(`"${raw}" doesn't look like a domain. Try youtube.com.`);
  return host;
}

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('rule')
          .setDescription('Turn a rule on or off and pick what happens.')
          .addStringOption((o) =>
            o
              .setName('name')
              .setDescription('Which rule')
              .setRequired(true)
              .addChoices(...RULES.map((r) => ({ name: `${r}: ${RULE_INFO[r].label}`, value: r }))),
          )
          .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('What happens (default delete). Warns count toward /config mod escalate.')
              .addChoices(...ACTIONS.map((a) => ({ name: a, value: a }))),
          )
          .addIntegerOption((o) =>
            o.setName('limit').setDescription('Rule limit (see /config automod show for what it means)').setMinValue(1).setMaxValue(100),
          )
          .addStringOption((o) => o.setName('duration').setDescription('Timeout length, like 10m (default 10m)')),
      )
      .addSubcommand((s) =>
        s
          .setName('words-add')
          .setDescription('Ban words or phrases (comma-separated).')
          .addStringOption((o) => o.setName('words').setDescription('Like: word1, some phrase').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('words-remove')
          .setDescription('Unban words or phrases (comma-separated).')
          .addStringOption((o) => o.setName('words').setDescription('Like: word1, some phrase').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('allow-link')
          .setDescription('Let links to a domain through the links rule (subdomains too).')
          .addStringOption((o) => o.setName('domain').setDescription('Like youtube.com').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('disallow-link')
          .setDescription('Take a domain off the allowlist.')
          .addStringOption((o) => o.setName('domain').setDescription('Like youtube.com').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('exempt')
          .setDescription('Let a role or channel skip automod. Anyone with Manage Messages always skips it.')
          .addBooleanOption((o) => o.setName('enabled').setDescription('Exempt or not').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role'))
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Show automod settings.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const reply = (text: string) => interaction.reply({ embeds: [ok(text)], flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'rule': {
        const rule = interaction.options.getString('name', true) as RuleName;
        const enabled = interaction.options.getBoolean('enabled', true);
        const action = (interaction.options.getString('action') ?? undefined) as RuleAction | undefined;
        const rawDuration = interaction.options.getString('duration');
        const duration = rawDuration ? parseDuration(rawDuration) : undefined;
        if (duration && duration > MAX_TIMEOUT_SECONDS) throw new UserError('Timeouts max out at 28d.');
        await setRule(guildId, rule, {
          enabled,
          ...(action ? { action } : {}),
          ...(interaction.options.getInteger('limit') !== null ? { limit: interaction.options.getInteger('limit') } : {}),
          ...(duration ? { duration } : {}),
        });
        const extra = rule === 'words' && enabled ? ' Add words with `/config automod words-add`.' : '';
        await reply(`**${rule}** is ${enabled ? 'on' : 'off'}.${extra}`);
        return;
      }
      case 'words-add':
      case 'words-remove': {
        const add = interaction.options.getSubcommand() === 'words-add';
        const words = splitItems(interaction.options.getString('words', true));
        if (words.length === 0) throw new UserError('Give me at least one word.');
        const list = await editList(guildId, 'bannedWords', words, add);
        if (list.length > MAX_WORDS) {
          await editList(guildId, 'bannedWords', words, false);
          throw new UserError(`That's over ${MAX_WORDS} banned words.`);
        }
        await reply(`${add ? 'Banned' : 'Unbanned'} ${words.length} word${words.length === 1 ? '' : 's'}. ${list.length} on the list.`);
        return;
      }
      case 'allow-link':
      case 'disallow-link': {
        const add = interaction.options.getSubcommand() === 'allow-link';
        const domain = normalizeDomain(interaction.options.getString('domain', true));
        const list = await editList(guildId, 'allowedDomains', [domain], add);
        if (list.length > MAX_DOMAINS) {
          await editList(guildId, 'allowedDomains', [domain], false);
          throw new UserError(`That's over ${MAX_DOMAINS} allowed domains.`);
        }
        await reply(`${domain} is ${add ? 'allowed' : 'no longer allowed'}.`);
        return;
      }
      case 'exempt': {
        const enabled = interaction.options.getBoolean('enabled', true);
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel');
        if (!role && !channel) throw new UserError('Pick a role or a channel.');
        if (role) await editList(guildId, 'exemptRoles', [role.id], enabled);
        if (channel) await editList(guildId, 'exemptChannels', [channel.id], enabled);
        const what = [role?.toString(), channel?.toString()].filter(Boolean).join(' and ');
        await reply(`${what} ${enabled ? 'skip' : 'no longer skip'} automod.`);
        return;
      }
      default: {
        const rows = new Map((await allRules(guildId)).map((r) => [r.rule, r]));
        const config = await getAutomod(guildId);
        const lines = RULES.map((r) => {
          const row = rows.get(r);
          const means = RULE_INFO[r].limitMeans;
          const limit = means ? ` · limit ${row?.limit ?? RULE_INFO[r].limit} ${means}` : '';
          const dur = row?.action === 'timeout' ? ` ${formatDuration(row.duration ?? 600)}` : '';
          return `${row?.enabled ? '●' : '○'} **${r}** ${row?.enabled ? `→ ${row.action}${dur}` : 'off'}${limit}`;
        });
        lines.push(
          '',
          `**Banned words** ${config.words.length}`,
          `**Allowed domains** ${config.allowedDomains.join(', ') || 'none'}`,
          `**Exempt** ${[...config.exemptRoles].map((id) => `<@&${id}>`).concat([...config.exemptChannels].map((id) => `<#${id}>`)).join(' ') || 'nobody (besides mods)'}`,
        );
        await interaction.reply({ embeds: [info(lines.join('\n').slice(0, 4096), 'Automod')], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async view(guildId) {
    const config = await getAutomod(guildId);
    return config.rules.size > 0 ? [...config.rules.keys()].join(', ') : 'no rules on';
  },
});
