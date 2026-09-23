import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { deployCommands } from './core/deploy.js';
import { buildRegistry, loadModules } from './core/loader.js';
import { log } from './core/log.js';
import { parseEnv } from './env.js';

const env = parseEnv(process.env);
const registry = buildRegistry(await loadModules(fileURLToPath(new URL('./modules', import.meta.url)), env.enabledModules));
const result = await deployCommands(env, registry);
log.info(`Deployed ${result.count} commands (${result.scope})`);
