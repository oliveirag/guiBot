import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Command, EventHandler, JobHandler, LoadedModule, ModuleMeta, Registry } from './types.js';

const SOURCE = /\.(ts|js)$/;
const SKIP = /\.(d|test)\.ts$/;

async function listSources(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((name) => SOURCE.test(name) && !SKIP.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function importDefault<T>(file: string): Promise<T> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: T };
  if (!mod.default) throw new Error(`${file} has no default export`);
  return mod.default;
}

async function importAll<T>(dir: string): Promise<T[]> {
  return Promise.all((await listSources(dir)).map((file) => importDefault<T>(file)));
}

async function findIndex(dir: string): Promise<string | null> {
  for (const name of ['index.ts', 'index.js']) {
    try {
      await stat(join(dir, name));
      return join(dir, name);
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** Loads every `root/<module>/index` plus its commands/, events/, and jobs/ folders. */
export async function loadModules(root: string, enabled: readonly string[] | null): Promise<LoadedModule[]> {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const modules: LoadedModule[] = [];
  for (const entry of entries) {
    const dir = join(root, entry.name);
    const index = await findIndex(dir);
    if (!index) continue;
    const meta = await importDefault<ModuleMeta>(index);
    if (enabled && !meta.alwaysOn && !enabled.includes(meta.name)) continue;
    modules.push({
      meta,
      commands: await importAll<Command>(join(dir, 'commands')),
      events: await importAll<EventHandler>(join(dir, 'events')),
      jobs: await importAll<JobHandler>(join(dir, 'jobs')),
    });
  }
  return modules;
}

export function buildRegistry(modules: LoadedModule[]): Registry {
  const commands: Registry['commands'] = new Map();
  for (const mod of modules) {
    for (const cmd of mod.commands) {
      const existing = commands.get(cmd.data.name);
      if (existing) {
        throw new Error(`Duplicate command /${cmd.data.name} in ${existing.module.name} and ${mod.meta.name}`);
      }
      commands.set(cmd.data.name, { command: cmd, module: mod.meta });
    }
  }
  return { modules, commands };
}
