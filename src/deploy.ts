import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { deployCommands } from './core/deploy.js';
import { buildRegistry, loadModules } from './core/loader.js';
import { log } from './core/log.js';
import { parseEnv } from './env.js';

const env = parseEnv(process.env);
const skipped: string[] = [];
const registry = buildRegistry(await loadModules(fileURLToPath(new URL('./modules', import.meta.url)), env.enabledModules, skipped));
if (skipped.length > 0) log.warn(`ENABLED_MODULES leaves out ${skipped.join(', ')}, so their commands are not deployed`);
try {
  const result = await deployCommands(env, registry);
  log.info(`Deployed ${result.count} commands (${result.scope}): ${[...registry.commands.keys()].map((n) => `/${n}`).join(' ')}`);
} catch (error) {
  log.error('command deploy failed, Discord still has the previous command list', error);
  process.exitCode = 1;
}
