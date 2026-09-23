import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { Cooldowns } from './core/cooldowns.js';
import { handleCommand } from './core/dispatch.js';
import { bindEvents } from './core/events.js';
import { isModuleEnabled } from './core/guildConfig.js';
import { buildServer } from './core/http.js';
import { buildRegistry, loadModules } from './core/loader.js';
import { log } from './core/log.js';
import { Scheduler } from './core/scheduler.js';
import { prisma } from './db.js';
import { parseEnv } from './env.js';

const env = parseEnv(process.env);
const registry = buildRegistry(await loadModules(fileURLToPath(new URL('./modules', import.meta.url)), env.enabledModules));
log.info(`Loaded modules: ${registry.modules.map((m) => m.meta.name).join(', ')}`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

const cooldowns = new Cooldowns();
bindEvents(client, registry, { isModuleEnabled, log });
client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand()) {
    void handleCommand(interaction, { registry, env, cooldowns, isModuleEnabled, log });
  }
});

const scheduler = new Scheduler({ handlers: registry.modules.flatMap((m) => m.jobs), log });
client.once(Events.ClientReady, async (ready) => {
  log.info(`Ready as ${ready.user.tag}`);
  const recovered = await scheduler.recoverStale();
  if (recovered > 0) log.warn(`Recovered ${recovered} stale jobs`);
  scheduler.start();
});

const server = buildServer();
await server.listen({ port: env.port, host: '0.0.0.0' });
log.info(`HTTP listening on ${env.port}`);

await client.login(env.discordToken);

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received, shutting down`);
  scheduler.stop();
  await server.close();
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => log.error('unhandled rejection', error));
