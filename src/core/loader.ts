import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  Command,
  ConfigSection,
  EventHandler,
  HttpRoutes,
  JobHandler,
  LoadedModule,
  ModuleMeta,
  Registry,
} from './types.js';

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

async function findEntry(dir: string, base: string): Promise<string | null> {
  for (const ext of ['ts', 'js']) {
    const file = join(dir, `${base}.${ext}`);
    try {
      await stat(file);
      return file;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** Loads every `root/<module>/index` plus its commands/, events/, jobs/, routes/ folders and optional config. */
export async function loadModules(root: string, enabled: readonly string[] | null): Promise<LoadedModule[]> {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const modules: LoadedModule[] = [];
  for (const entry of entries) {
    const dir = join(root, entry.name);
    const index = await findEntry(dir, 'index');
    if (!index) continue;
    const meta = await importDefault<ModuleMeta>(index);
    if (enabled && !meta.alwaysOn && !enabled.includes(meta.name)) continue;
    const configFile = await findEntry(dir, 'config');
    modules.push({
      meta,
      commands: await importAll<Command>(join(dir, 'commands')),
      events: await importAll<EventHandler>(join(dir, 'events')),
      jobs: await importAll<JobHandler>(join(dir, 'jobs')),
      config: configFile ? await importDefault<ConfigSection>(configFile) : null,
      routes: await importAll<HttpRoutes>(join(dir, 'routes')),
    });
  }
  return modules;
}

export function buildRegistry(modules: LoadedModule[]): Registry {
  const commands: Registry['commands'] = new Map();
  for (const mod of modules) {
    for (const cmd of mod.commands) {
      const resolved = cmd.dataFor ? { ...cmd, data: cmd.dataFor(modules) } : cmd;
      const existing = commands.get(resolved.data.name);
      if (existing) {
        throw new Error(`Duplicate command /${resolved.data.name} in ${existing.module.name} and ${mod.meta.name}`);
      }
      commands.set(resolved.data.name, { command: resolved, module: mod.meta });
    }
  }
  return { modules, commands };
}
