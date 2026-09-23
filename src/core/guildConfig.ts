import { prisma } from '../db.js';

// Single process, so an in-memory cache stays correct as long as writes go through here.
const cache = new Map<string, Set<string>>();

function parse(csv: string): Set<string> {
  return new Set(
    csv
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

export async function getDisabledModules(guildId: string): Promise<ReadonlySet<string>> {
  const hit = cache.get(guildId);
  if (hit) return hit;
  const row = await prisma.guildConfig.findUnique({ where: { guildId } });
  const disabled = parse(row?.disabledModules ?? '');
  cache.set(guildId, disabled);
  return disabled;
}

export async function isModuleEnabled(guildId: string, module: string): Promise<boolean> {
  return !(await getDisabledModules(guildId)).has(module);
}

export async function setModuleEnabled(guildId: string, module: string, enabled: boolean): Promise<void> {
  const next = new Set(await getDisabledModules(guildId));
  if (enabled) next.delete(module);
  else next.add(module);
  const disabledModules = [...next].sort().join(',');
  await prisma.guildConfig.upsert({
    where: { guildId },
    create: { guildId, disabledModules },
    update: { disabledModules },
  });
  cache.set(guildId, next);
}

export function clearGuildConfigCache(): void {
  cache.clear();
}
