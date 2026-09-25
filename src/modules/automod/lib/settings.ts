import { prisma } from '../../../db.js';
import { RULES, type RuleAction, type RuleConfig, type RuleName } from './engine.js';

export const MAX_WORDS = 200;
export const MAX_DOMAINS = 50;

export interface AutomodConfig {
  rules: ReadonlyMap<RuleName, RuleConfig>;
  words: string[];
  allowedDomains: string[];
  exemptRoles: ReadonlySet<string>;
  exemptChannels: ReadonlySet<string>;
}

const csv = (text: string): string[] => text.split(',').filter(Boolean);

// Checked on every message, so cached. Every write goes through this file and clears the guild's entry.
const cache = new Map<string, AutomodConfig>();

export async function getAutomod(guildId: string): Promise<AutomodConfig> {
  const hit = cache.get(guildId);
  if (hit) return hit;
  const [rows, settings] = await Promise.all([
    prisma.automodRule.findMany({ where: { guildId, enabled: true } }),
    prisma.automodSettings.findUnique({ where: { guildId } }),
  ]);
  const rules = new Map<RuleName, RuleConfig>();
  for (const r of rows) {
    if (!(RULES as readonly string[]).includes(r.rule)) continue;
    rules.set(r.rule as RuleName, { rule: r.rule as RuleName, action: r.action as RuleAction, limit: r.limit, duration: r.duration });
  }
  const config: AutomodConfig = {
    rules,
    words: (settings?.bannedWords ?? '').split('\n').filter(Boolean),
    allowedDomains: csv(settings?.allowedDomains ?? ''),
    exemptRoles: new Set(csv(settings?.exemptRoles ?? '')),
    exemptChannels: new Set(csv(settings?.exemptChannels ?? '')),
  };
  cache.set(guildId, config);
  return config;
}

export function clearAutomodCache(): void {
  cache.clear();
}

export async function setRule(
  guildId: string,
  rule: RuleName,
  patch: { enabled: boolean; action?: RuleAction; limit?: number | null; duration?: number | null },
): Promise<void> {
  await prisma.automodRule.upsert({
    where: { guildId_rule: { guildId, rule } },
    create: { guildId, rule, ...patch },
    update: patch,
  });
  cache.delete(guildId);
}

type ListField = 'bannedWords' | 'allowedDomains' | 'exemptRoles' | 'exemptChannels';
const SEPARATOR: Record<ListField, string> = { bannedWords: '\n', allowedDomains: ',', exemptRoles: ',', exemptChannels: ',' };

/** Adds or removes items from one of the list settings. Returns the list afterwards. */
export async function editList(guildId: string, field: ListField, items: string[], add: boolean): Promise<string[]> {
  const row = await prisma.automodSettings.findUnique({ where: { guildId } });
  const sep = SEPARATOR[field];
  const current = new Set((row?.[field] ?? '').split(sep).filter(Boolean));
  for (const item of items) {
    if (add) current.add(item);
    else current.delete(item);
  }
  const value = [...current].join(sep);
  await prisma.automodSettings.upsert({ where: { guildId }, create: { guildId, [field]: value }, update: { [field]: value } });
  cache.delete(guildId);
  return [...current];
}

export function allRules(guildId: string) {
  return prisma.automodRule.findMany({ where: { guildId } });
}
