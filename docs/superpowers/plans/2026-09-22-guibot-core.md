# guiBot Core (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old PrizePicks script with a TypeScript guiBot skeleton: module loader, command dispatch with perms/cooldowns/per-guild toggles, DB-backed job scheduler, healthcheck server, and the core module (/help, /ping, /about, /config), deployable to Railway.

**Architecture:** One Node process runs the discord.js gateway client, a Fastify HTTP server, and a DB-polling scheduler. Features live in `src/modules/<name>/` with `index.ts` (module meta) plus auto-discovered `commands/`, `events/`, `jobs/` folders, one default export per file. `src/core/` holds the framework: loader, registry, dispatch, perms, cooldowns, embeds, errors, guild config, scheduler.

**Tech Stack:** TypeScript 5.9 (ESM, NodeNext), Node 22, discord.js v14, Prisma 6 + SQLite, Fastify 5, zod 4, Vitest 3, tsx.

**Spec:** `docs/superpowers/specs/2026-09-21-guibot-design.md`

## Global Constraints

- Node 22 (`engines.node >=22`), ESM (`"type": "module"`), relative imports end in `.js`.
- Prisma pinned to `^6` on purpose (Prisma 7 requires driver adapters and a new generator; not worth it here).
- Slash commands only. Per-guild registration when `DEV_GUILD_ID` is set and not production, global otherwise.
- Privileged intents: GuildMembers, MessageContent (must be toggled on in the Discord Developer Portal).
- Brand accent `#3B82F6` (`0x3b82f6`). Voice: clean, minimal, lightly playful.
- No hardcoded guild, channel, role, or user IDs. Owners come from `OWNER_IDS`, everything else from per-guild DB config.
- All DB rows keyed by `guildId` where guild-scoped.
- `ENABLED_MODULES` (comma-separated, empty = all) limits which modules load. Modules with `alwaysOn` always load and can't be disabled per guild.
- Job types are namespaced `<module>.<name>` (e.g. `sd.standupReminder`).
- Hosting: Railway via Dockerfile, SQLite at `/data/guibot.db` on a Railway volume.
- Commit messages: one lowercase line, no `feat:`/`fix:` prefix, no body, no co-author or session trailers.
- Never print or commit `.env`.

## File Structure

```
legacy/prizepicks/           old JS bot, kept for the slice 13 port (not built)
prisma/schema.prisma         GuildConfig + Job models
src/
  env.ts                     parseEnv(): validated Env
  db.ts                      shared PrismaClient
  index.ts                   process entry: wires client, events, dispatch, scheduler, http
  deploy.ts                  script entry: registers slash commands
  core/
    types.ts                 Command, EventHandler, JobHandler, ModuleMeta, LoadedModule, Registry
    define.ts                command(), event(), job(), moduleMeta() typing helpers
    cooldowns.ts             Cooldowns (in-memory, per key)
    perms.ts                 checkAccess() for ownerOnly/guildOnly/memberPermissions
    log.ts                   tiny timestamped logger
    embeds.ts                BRAND_COLOR, info(), ok(), err()
    errors.ts                UserError, GENERIC_ERROR, reportError()
    reply.ts                 respond(): reply/editReply/followUp picker
    guildConfig.ts           per-guild module toggles (cached)
    loader.ts                loadModules(), buildRegistry()
    dispatch.ts              handleCommand()
    events.ts                extractGuildId(), bindEvents()
    scheduler.ts             scheduleJob(), Scheduler
    http.ts                  buildServer() with GET /health
    deploy.ts                commandPayload(), deployCommands()
  modules/core/
    index.ts                 module meta (alwaysOn)
    commands/ping.ts, about.ts, help.ts, config.ts
    lib/help.ts, lib/config.ts, lib/format.ts   pure builders (not auto-loaded)
tests/
  globalSetup.ts             fresh SQLite test DB
  db.ts                      resetDb()
  helpers.ts                 fakes for interactions, commands, modules, env, logger
  fixtures/modules/          loader fixtures
  core/*.test.ts, modules/core/*.test.ts
Dockerfile, .dockerignore, railway.json, .env.example
```

Out of scope for this slice: modules other than core, webhooks (slice 2), and `/config <module>` sections for other modules (each later slice adds its own).

---

### Task 1: Project scaffold and env parsing

**Files:**
- Move: `index.js`, `scraper.js`, `formatter.js`, `users.js` → `legacy/prizepicks/`
- Replace: `package.json`, `.gitignore`
- Delete: `package-lock.json`, `node_modules/`
- Create: `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.env.example`, `src/env.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces: `parseEnv(raw: Record<string, string | undefined>): Env` and
  `interface Env { discordToken: string; clientId: string; devGuildId?: string; databaseUrl: string; port: number; enabledModules: string[] | null; ownerIds: string[]; isProduction: boolean }`

- [ ] **Step 1: Move the legacy bot and reset dependencies**

```bash
mkdir -p legacy/prizepicks
git mv index.js scraper.js formatter.js users.js legacy/prizepicks/
rm -rf node_modules package-lock.json
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "guibot",
  "version": "0.1.0",
  "private": true,
  "description": "Gui's personal everything bot for Discord.",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "deploy": "tsx src/deploy.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install discord.js@^14.25 fastify@^5 zod@^4 dotenv@^17 @prisma/client@^6 prisma@^6
npm install -D typescript@^5.9 tsx@^4 vitest@^3 @types/node@^22
```

`prisma` is a runtime dependency because the container runs `prisma migrate deploy` on boot.

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Write `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: Write `.gitignore`**

```
node_modules/
dist/
.env
.DS_Store
debug_*.html
seen_entries.json
prisma/*.db
prisma/*.db-journal
```

- [ ] **Step 8: Write `.env.example`**

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DEV_GUILD_ID=
DATABASE_URL=file:./dev.db
PORT=3000
ENABLED_MODULES=
OWNER_IDS=
NODE_ENV=development
```

- [ ] **Step 9: Write the failing test `tests/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

const base = { DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'client' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env).toEqual({
      discordToken: 'token',
      clientId: 'client',
      devGuildId: undefined,
      databaseUrl: 'file:./dev.db',
      port: 3000,
      enabledModules: null,
      ownerIds: [],
      isProduction: false,
    });
  });

  it('splits and trims list vars', () => {
    const env = parseEnv({ ...base, ENABLED_MODULES: ' core, sd ,', OWNER_IDS: '1,2' });
    expect(env.enabledModules).toEqual(['core', 'sd']);
    expect(env.ownerIds).toEqual(['1', '2']);
  });

  it('treats an empty DEV_GUILD_ID as unset and reads production', () => {
    const env = parseEnv({ ...base, DEV_GUILD_ID: '', NODE_ENV: 'production', PORT: '8080' });
    expect(env.devGuildId).toBeUndefined();
    expect(env.isProduction).toBe(true);
    expect(env.port).toBe(8080);
  });

  it('names missing required vars', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN.*DISCORD_CLIENT_ID/);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL, cannot resolve `../src/env.js`

- [ ] **Step 11: Write `src/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DEV_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  ENABLED_MODULES: z.string().optional(),
  OWNER_IDS: z.string().default(''),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface Env {
  discordToken: string;
  clientId: string;
  devGuildId?: string;
  databaseUrl: string;
  port: number;
  enabledModules: string[] | null;
  ownerIds: string[];
  isProduction: boolean;
}

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  const e = result.data;
  const enabled = csv(e.ENABLED_MODULES);
  return {
    discordToken: e.DISCORD_TOKEN,
    clientId: e.DISCORD_CLIENT_ID,
    devGuildId: e.DEV_GUILD_ID || undefined,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    enabledModules: enabled.length > 0 ? enabled : null,
    ownerIds: csv(e.OWNER_IDS),
    isProduction: e.NODE_ENV === 'production',
  };
}
```

- [ ] **Step 12: Run tests and typecheck**

Run: `npx vitest run tests/env.test.ts && npm run typecheck`
Expected: 4 tests PASS, typecheck clean

- [ ] **Step 13: Commit**

```bash
git add -A legacy package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts .gitignore .env.example src/env.ts tests/env.test.ts docs/superpowers
git commit -m "scaffold typescript guibot and move prizepicks code to legacy"
```

---

### Task 2: Database schema and per-guild module toggles

**Files:**
- Create: `prisma/schema.prisma`, `src/db.ts`, `src/core/guildConfig.ts`, `tests/globalSetup.ts`, `tests/db.ts`
- Modify: `vitest.config.ts` (full replacement below)
- Test: `tests/core/guildConfig.test.ts`

**Interfaces:**
- Produces:
  - `prisma: PrismaClient` from `src/db.ts`
  - `getDisabledModules(guildId: string): Promise<ReadonlySet<string>>`
  - `isModuleEnabled(guildId: string, module: string): Promise<boolean>`
  - `setModuleEnabled(guildId: string, module: string, enabled: boolean): Promise<void>`
  - `clearGuildConfigCache(): void`
  - Prisma models `GuildConfig { guildId, disabledModules }` and `Job { id, type, guildId, payload, runAt, status, attempts, lastError }`
  - `resetDb(): Promise<void>` test helper

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model GuildConfig {
  guildId         String   @id
  // Comma-separated module names. SQLite has no scalar lists.
  disabledModules String   @default("")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Job {
  id        Int      @id @default(autoincrement())
  type      String
  guildId   String?
  // JSON-encoded payload.
  payload   String
  runAt     DateTime
  // pending | running | done | failed
  status    String   @default("pending")
  attempts  Int      @default(0)
  lastError String?
  createdAt DateTime @default(now())

  @@index([status, runAt])
}
```

- [ ] **Step 2: Create the first migration**

Run: `DATABASE_URL=file:./dev.db npx prisma migrate dev --name init`
Expected: `prisma/migrations/<timestamp>_init/migration.sql` created, client generated

- [ ] **Step 3: Write `src/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 4: Write `tests/globalSetup.ts`**

Deletes the test DB file instead of using `--force-reset`, which Prisma blocks when run by AI agents.

```ts
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export default function setup(): void {
  for (const file of ['prisma/test.db', 'prisma/test.db-journal']) rmSync(file, { force: true });
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
}
```

- [ ] **Step 5: Replace `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    env: { DATABASE_URL: 'file:./test.db', NODE_ENV: 'test' },
    // One SQLite file shared by all test files.
    fileParallelism: false,
  },
});
```

- [ ] **Step 6: Write `tests/db.ts`**

```ts
import { prisma } from '../src/db.js';
import { clearGuildConfigCache } from '../src/core/guildConfig.js';

export async function resetDb(): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.guildConfig.deleteMany();
  clearGuildConfigCache();
}
```

- [ ] **Step 7: Write the failing test `tests/core/guildConfig.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import {
  clearGuildConfigCache,
  getDisabledModules,
  isModuleEnabled,
  setModuleEnabled,
} from '../../src/core/guildConfig.js';
import { resetDb } from '../db.js';

describe('guildConfig', () => {
  beforeEach(resetDb);

  it('treats every module as enabled for an unknown guild without creating a row', async () => {
    expect(await isModuleEnabled('g1', 'levels')).toBe(true);
    expect(await prisma.guildConfig.count()).toBe(0);
  });

  it('persists a disabled module', async () => {
    await setModuleEnabled('g1', 'levels', false);
    clearGuildConfigCache();
    expect(await isModuleEnabled('g1', 'levels')).toBe(false);
    expect([...(await getDisabledModules('g1'))]).toEqual(['levels']);
  });

  it('re-enables a module', async () => {
    await setModuleEnabled('g1', 'levels', false);
    await setModuleEnabled('g1', 'levels', true);
    clearGuildConfigCache();
    expect(await isModuleEnabled('g1', 'levels')).toBe(true);
  });

  it('keeps guilds separate', async () => {
    await setModuleEnabled('g1', 'fun', false);
    expect(await isModuleEnabled('g2', 'fun')).toBe(true);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run tests/core/guildConfig.test.ts`
Expected: FAIL, cannot resolve `../../src/core/guildConfig.js`

- [ ] **Step 9: Write `src/core/guildConfig.ts`**

```ts
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
```

- [ ] **Step 10: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: env + guildConfig tests PASS, typecheck clean

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/db.ts src/core/guildConfig.ts tests/globalSetup.ts tests/db.ts tests/core/guildConfig.test.ts vitest.config.ts
git commit -m "add prisma sqlite schema and per-guild module toggles"
```

---

### Task 3: Core types, define helpers, cooldowns, perms

**Files:**
- Create: `src/core/types.ts`, `src/core/define.ts`, `src/core/cooldowns.ts`, `src/core/perms.ts`, `tests/helpers.ts`
- Test: `tests/core/cooldowns.test.ts`, `tests/core/perms.test.ts`

**Interfaces:**
- Consumes: `Env` from `src/env.ts`
- Produces (all of `src/core/types.ts` below), plus:
  - `command(c: Command): Command`, `event<K>(e: EventHandler<K>): EventHandler<K>`, `job(j: JobHandler): JobHandler`, `moduleMeta(m: ModuleMeta): ModuleMeta`
  - `class Cooldowns { constructor(now?: () => number); hit(key: string, seconds: number): number }`
  - `checkAccess(rules: AccessRules, input: AccessInput): string | null`
  - Test helpers: `fakeInteraction()`, `asInteraction()`, `lastEmbed()`, `fakeCommand()`, `fakeModule()`, `testEnv()`, `silentLog()`

- [ ] **Step 1: Write `src/core/types.ts`**

```ts
import type {
  ChatInputCommandInteraction,
  ClientEvents,
  PermissionResolvable,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Env } from '../env.js';

// Matches SlashCommandBuilder and its subcommand/option builder variants.
export interface CommandData {
  name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface AccessRules {
  ownerOnly?: boolean;
  guildOnly?: boolean;
  memberPermissions?: PermissionResolvable;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  registry: Registry;
  env: Env;
}

export interface Command extends AccessRules {
  data: CommandData;
  cooldownSeconds?: number;
  run(ctx: CommandContext): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  run(...args: ClientEvents[K]): unknown;
}

export interface JobContext {
  id: number;
  guildId: string | null;
}

export interface JobHandler {
  type: string;
  run(payload: unknown, job: JobContext): Promise<void>;
}

export interface ModuleMeta {
  name: string;
  description: string;
  alwaysOn?: boolean;
}

export interface LoadedModule {
  meta: ModuleMeta;
  commands: Command[];
  events: EventHandler[];
  jobs: JobHandler[];
}

export interface Registry {
  modules: LoadedModule[];
  commands: Map<string, { command: Command; module: ModuleMeta }>;
}
```

- [ ] **Step 2: Write `src/core/define.ts`**

```ts
import type { ClientEvents } from 'discord.js';
import type { Command, EventHandler, JobHandler, ModuleMeta } from './types.js';

// Identity helpers so each module file gets full type checking with one import.
export const command = (c: Command): Command => c;
export const event = <K extends keyof ClientEvents>(e: EventHandler<K>): EventHandler<K> => e;
export const job = (j: JobHandler): JobHandler => j;
export const moduleMeta = (m: ModuleMeta): ModuleMeta => m;
```

- [ ] **Step 3: Write `tests/helpers.ts`**

```ts
import { SlashCommandBuilder, type APIEmbed, type ChatInputCommandInteraction, type EmbedBuilder } from 'discord.js';
import { vi, type Mock } from 'vitest';
import type { Env } from '../src/env.js';
import type { Command, EventHandler, LoadedModule, ModuleMeta } from '../src/core/types.js';

export interface FakeInteraction {
  commandName: string;
  user: { id: string };
  guildId: string | null;
  memberPermissions: { has: (permission: unknown) => boolean } | null;
  replied: boolean;
  deferred: boolean;
  inGuild(): boolean;
  reply: Mock;
  followUp: Mock;
  editReply: Mock;
}

export function fakeInteraction(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  const i: FakeInteraction = {
    commandName: 'ping',
    user: { id: 'u1' },
    guildId: 'g1',
    memberPermissions: { has: () => true },
    replied: false,
    deferred: false,
    inGuild: () => i.guildId !== null,
    reply: vi.fn(async () => {
      i.replied = true;
    }),
    followUp: vi.fn(async () => {}),
    editReply: vi.fn(async () => {
      i.replied = true;
    }),
    ...overrides,
  };
  return i;
}

export const asInteraction = (i: FakeInteraction): ChatInputCommandInteraction =>
  i as unknown as ChatInputCommandInteraction;

export function lastEmbed(mock: Mock): APIEmbed {
  const payload = mock.mock.calls.at(-1)?.[0] as { embeds: EmbedBuilder[] };
  return payload.embeds[0]!.toJSON();
}

export function fakeCommand(name: string, extra: Partial<Command> = {}): Command {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} command`),
    run: vi.fn(async () => {}),
    ...extra,
  };
}

export function fakeModule(
  name: string,
  commands: Command[] = [],
  meta: Partial<ModuleMeta> = {},
  events: EventHandler[] = [],
): LoadedModule {
  return { meta: { name, description: `${name} module`, ...meta }, commands, events, jobs: [] };
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    discordToken: 'token',
    clientId: 'client',
    databaseUrl: 'file:./test.db',
    port: 0,
    enabledModules: null,
    ownerIds: ['owner'],
    isProduction: false,
    ...overrides,
  };
}

export function silentLog(): { info: Mock; warn: Mock; error: Mock } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
```

- [ ] **Step 4: Write the failing tests**

`tests/core/cooldowns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Cooldowns } from '../../src/core/cooldowns.js';

describe('Cooldowns', () => {
  it('allows the first hit and blocks until the window passes', () => {
    let now = 0;
    const cooldowns = new Cooldowns(() => now);
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
    now = 1_200;
    expect(cooldowns.hit('ping:u1', 5)).toBe(4);
    now = 5_000;
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
  });

  it('tracks keys independently', () => {
    const cooldowns = new Cooldowns(() => 0);
    expect(cooldowns.hit('ping:u1', 5)).toBe(0);
    expect(cooldowns.hit('ping:u2', 5)).toBe(0);
  });
});
```

`tests/core/perms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkAccess, type AccessInput } from '../../src/core/perms.js';

const input = (overrides: Partial<AccessInput> = {}): AccessInput => ({
  userId: 'u1',
  ownerIds: ['owner'],
  inGuild: true,
  has: () => true,
  ...overrides,
});

describe('checkAccess', () => {
  it('allows commands with no rules', () => {
    expect(checkAccess({}, input())).toBeNull();
  });

  it('blocks non-owners from owner-only commands', () => {
    expect(checkAccess({ ownerOnly: true }, input())).toMatch(/owner/);
    expect(checkAccess({ ownerOnly: true }, input({ userId: 'owner' }))).toBeNull();
  });

  it('blocks guild-only commands in DMs', () => {
    expect(checkAccess({ guildOnly: true }, input({ inGuild: false }))).toMatch(/server/);
  });

  it('checks member permissions', () => {
    expect(checkAccess({ memberPermissions: 'ManageGuild' }, input({ has: () => false }))).toMatch(/permission/);
    expect(checkAccess({ memberPermissions: 'ManageGuild' }, input())).toBeNull();
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run tests/core/cooldowns.test.ts tests/core/perms.test.ts`
Expected: FAIL, cannot resolve the source modules

- [ ] **Step 6: Write `src/core/cooldowns.ts`**

```ts
const PRUNE_AT = 5_000;

export class Cooldowns {
  private readonly expires = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns seconds left if `key` is cooling down, otherwise records the hit and returns 0. */
  hit(key: string, seconds: number): number {
    const t = this.now();
    const until = this.expires.get(key);
    if (until !== undefined && until > t) return Math.ceil((until - t) / 1000);
    if (this.expires.size > PRUNE_AT) {
      for (const [k, v] of this.expires) if (v <= t) this.expires.delete(k);
    }
    this.expires.set(key, t + seconds * 1000);
    return 0;
  }
}
```

- [ ] **Step 7: Write `src/core/perms.ts`**

```ts
import type { PermissionResolvable } from 'discord.js';
import type { AccessRules } from './types.js';

export interface AccessInput {
  userId: string;
  ownerIds: readonly string[];
  inGuild: boolean;
  has: (permission: PermissionResolvable) => boolean;
}

/** Returns a user-facing denial message, or null if allowed. */
export function checkAccess(rules: AccessRules, input: AccessInput): string | null {
  if (rules.ownerOnly && !input.ownerIds.includes(input.userId)) return 'Only the bot owner can use this.';
  if (rules.guildOnly && !input.inGuild) return 'This only works in a server.';
  if (rules.memberPermissions && !input.has(rules.memberPermissions)) return "You don't have permission to use this.";
  return null;
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/define.ts src/core/cooldowns.ts src/core/perms.ts tests/helpers.ts tests/core/cooldowns.test.ts tests/core/perms.test.ts
git commit -m "add core types, define helpers, cooldowns, and perms"
```

---

### Task 4: Logger, branded embeds, replies, error handling

**Files:**
- Create: `src/core/log.ts`, `src/core/embeds.ts`, `src/core/reply.ts`, `src/core/errors.ts`
- Test: `tests/core/embeds.test.ts`, `tests/core/errors.test.ts`

**Interfaces:**
- Produces:
  - `log: Logger`, `interface Logger { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }`
  - `BRAND_COLOR = 0x3b82f6`, `ERROR_COLOR = 0xef4444`, `info(description: string, title?: string): EmbedBuilder`, `ok(...)`, `err(...)`
  - `type Repliable = Pick<ChatInputCommandInteraction, 'reply' | 'followUp' | 'editReply' | 'replied' | 'deferred'>`
  - `respond(interaction: Repliable, embed: EmbedBuilder, ephemeral?: boolean): Promise<void>`
  - `class UserError extends Error`, `GENERIC_ERROR: string`, `reportError(interaction: Repliable, error: unknown, log: Logger): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`tests/core/embeds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BRAND_COLOR, ERROR_COLOR, err, info, ok } from '../../src/core/embeds.js';

describe('embeds', () => {
  it('info uses the brand color and optional title', () => {
    const json = info('hello', 'Title').toJSON();
    expect(json).toMatchObject({ color: BRAND_COLOR, description: 'hello', title: 'Title' });
  });

  it('ok prefixes a check mark', () => {
    expect(ok('saved').toJSON()).toMatchObject({ color: BRAND_COLOR, description: '✓ saved' });
  });

  it('err uses the error color', () => {
    expect(err('nope').toJSON()).toMatchObject({ color: ERROR_COLOR, description: '✕ nope' });
  });
});
```

`tests/core/errors.test.ts`:

```ts
import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR, UserError, reportError } from '../../src/core/errors.js';
import { info } from '../../src/core/embeds.js';
import { respond } from '../../src/core/reply.js';
import { asInteraction, fakeInteraction, lastEmbed, silentLog } from '../helpers.js';

describe('respond', () => {
  it('replies ephemerally when nothing was sent yet', async () => {
    const i = fakeInteraction();
    await respond(asInteraction(i), info('hi'));
    expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('edits the deferred reply', async () => {
    const i = fakeInteraction({ deferred: true });
    await respond(asInteraction(i), info('hi'));
    expect(i.editReply).toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('follows up after a reply', async () => {
    const i = fakeInteraction({ replied: true });
    await respond(asInteraction(i), info('hi'));
    expect(i.followUp).toHaveBeenCalled();
  });
});

describe('reportError', () => {
  it('shows UserError messages without logging', async () => {
    const i = fakeInteraction();
    const log = silentLog();
    await reportError(asInteraction(i), new UserError('Pick a smaller number.'), log);
    expect(lastEmbed(i.reply).description).toContain('Pick a smaller number.');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('hides unexpected errors and logs them', async () => {
    const i = fakeInteraction();
    const log = silentLog();
    await reportError(asInteraction(i), new Error('db exploded'), log);
    expect(lastEmbed(i.reply).description).toContain(GENERIC_ERROR);
    expect(lastEmbed(i.reply).description).not.toContain('db exploded');
    expect(log.error).toHaveBeenCalled();
  });

  it('logs instead of throwing if the error reply itself fails', async () => {
    const i = fakeInteraction();
    i.reply.mockRejectedValueOnce(new Error('unknown interaction'));
    const log = silentLog();
    await expect(reportError(asInteraction(i), new UserError('x'), log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/core/embeds.test.ts tests/core/errors.test.ts`
Expected: FAIL, cannot resolve the source modules

- [ ] **Step 3: Write `src/core/log.ts`**

```ts
const stamp = (): string => new Date().toISOString();

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const log: Logger = {
  info: (...args) => console.log(stamp(), 'INFO', ...args),
  warn: (...args) => console.warn(stamp(), 'WARN', ...args),
  error: (...args) => console.error(stamp(), 'ERROR', ...args),
};
```

- [ ] **Step 4: Write `src/core/embeds.ts`**

```ts
import { EmbedBuilder } from 'discord.js';

export const BRAND_COLOR = 0x3b82f6;
export const ERROR_COLOR = 0xef4444;

function build(color: number, description: string, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

export const info = (description: string, title?: string): EmbedBuilder => build(BRAND_COLOR, description, title);
export const ok = (description: string, title?: string): EmbedBuilder => build(BRAND_COLOR, `✓ ${description}`, title);
export const err = (description: string, title?: string): EmbedBuilder => build(ERROR_COLOR, `✕ ${description}`, title);
```

- [ ] **Step 5: Write `src/core/reply.ts`**

```ts
import { MessageFlags, type ChatInputCommandInteraction, type EmbedBuilder } from 'discord.js';

export type Repliable = Pick<ChatInputCommandInteraction, 'reply' | 'followUp' | 'editReply' | 'replied' | 'deferred'>;

/** Sends an embed whether or not the interaction was already answered or deferred. */
export async function respond(interaction: Repliable, embed: EmbedBuilder, ephemeral = true): Promise<void> {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({ embeds: [embed], flags });
  } else {
    await interaction.reply({ embeds: [embed], flags });
  }
}
```

- [ ] **Step 6: Write `src/core/errors.ts`**

```ts
import { err } from './embeds.js';
import type { Logger } from './log.js';
import { respond, type Repliable } from './reply.js';

/** An error whose message is safe and meant to be shown to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export const GENERIC_ERROR = "Something broke on my end. It's been logged.";

export async function reportError(interaction: Repliable, error: unknown, log: Logger): Promise<void> {
  const isUserError = error instanceof UserError;
  if (!isUserError) log.error('command failed', error);
  try {
    await respond(interaction, err(isUserError ? error.message : GENERIC_ERROR));
  } catch (replyError) {
    log.error('failed to report error to user', replyError);
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 8: Commit**

```bash
git add src/core/log.ts src/core/embeds.ts src/core/reply.ts src/core/errors.ts tests/core/embeds.test.ts tests/core/errors.test.ts
git commit -m "add branded embeds, reply helper, and error reporting"
```

---

### Task 5: Module loader and command registry

**Files:**
- Create: `src/core/loader.ts`
- Create fixtures: `tests/fixtures/modules/alpha/index.ts`, `tests/fixtures/modules/alpha/commands/one.ts`, `tests/fixtures/modules/beta/index.ts`, `tests/fixtures/modules/beta/commands/two.ts`, `tests/fixtures/modules/beta/events/message.ts`, `tests/fixtures/modules/beta/jobs/tick.ts`, `tests/fixtures/modules/notamodule/README.md`
- Test: `tests/core/loader.test.ts`

**Interfaces:**
- Consumes: `command`, `event`, `job`, `moduleMeta` from `src/core/define.ts`; types from `src/core/types.ts`
- Produces:
  - `loadModules(root: string, enabled: readonly string[] | null): Promise<LoadedModule[]>`
  - `buildRegistry(modules: LoadedModule[]): Registry` (throws on duplicate command names)

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/modules/alpha/index.ts`:

```ts
import { moduleMeta } from '../../../../src/core/define.js';

export default moduleMeta({ name: 'alpha', description: 'Alpha module', alwaysOn: true });
```

`tests/fixtures/modules/alpha/commands/one.ts`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../../../src/core/define.js';

export default command({
  data: new SlashCommandBuilder().setName('one').setDescription('First'),
  async run() {},
});
```

`tests/fixtures/modules/beta/index.ts`:

```ts
import { moduleMeta } from '../../../../src/core/define.js';

export default moduleMeta({ name: 'beta', description: 'Beta module' });
```

`tests/fixtures/modules/beta/commands/two.ts`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../../../src/core/define.js';

export default command({
  data: new SlashCommandBuilder().setName('two').setDescription('Second'),
  async run() {},
});
```

`tests/fixtures/modules/beta/events/message.ts`:

```ts
import { event } from '../../../../../src/core/define.js';

export default event({ name: 'messageCreate', run: () => {} });
```

`tests/fixtures/modules/beta/jobs/tick.ts`:

```ts
import { job } from '../../../../../src/core/define.js';

export default job({ type: 'beta.tick', async run() {} });
```

`tests/fixtures/modules/notamodule/README.md`:

```md
No index file, so the loader skips this folder.
```

- [ ] **Step 2: Write the failing test `tests/core/loader.test.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRegistry, loadModules } from '../../src/core/loader.js';
import { fakeCommand, fakeModule } from '../helpers.js';

const root = fileURLToPath(new URL('../fixtures/modules', import.meta.url));

describe('loadModules', () => {
  it('loads every module folder that has an index', async () => {
    const modules = await loadModules(root, null);
    expect(modules.map((m) => m.meta.name)).toEqual(['alpha', 'beta']);
    const beta = modules[1]!;
    expect(beta.commands.map((c) => c.data.name)).toEqual(['two']);
    expect(beta.events.map((e) => e.name)).toEqual(['messageCreate']);
    expect(beta.jobs.map((j) => j.type)).toEqual(['beta.tick']);
  });

  it('only loads enabled modules but always keeps alwaysOn ones', async () => {
    const modules = await loadModules(root, ['something-else']);
    expect(modules.map((m) => m.meta.name)).toEqual(['alpha']);
  });
});

describe('buildRegistry', () => {
  it('maps command names to their command and module', () => {
    const ping = fakeCommand('ping');
    const registry = buildRegistry([fakeModule('core', [ping])]);
    expect(registry.commands.get('ping')).toEqual({ command: ping, module: expect.objectContaining({ name: 'core' }) });
  });

  it('rejects duplicate command names across modules', () => {
    expect(() => buildRegistry([fakeModule('a', [fakeCommand('ping')]), fakeModule('b', [fakeCommand('ping')])])).toThrow(
      /Duplicate command \/ping in a and b/,
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/loader.test.ts`
Expected: FAIL, cannot resolve `../../src/core/loader.js`

- [ ] **Step 4: Write `src/core/loader.ts`**

```ts
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
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add src/core/loader.ts tests/fixtures tests/core/loader.test.ts
git commit -m "add module auto-loader and command registry"
```

---

### Task 6: Command dispatch and event binding

**Files:**
- Create: `src/core/dispatch.ts`, `src/core/events.ts`
- Test: `tests/core/dispatch.test.ts`, `tests/core/events.test.ts`

**Interfaces:**
- Consumes: `Registry`, `Cooldowns`, `checkAccess`, `UserError`, `reportError`, `respond`, `err`, `Logger`, `Env`
- Produces:
  - `interface DispatchDeps { registry: Registry; env: Env; cooldowns: Cooldowns; isModuleEnabled: (guildId: string, module: string) => Promise<boolean>; log: Logger }`
  - `handleCommand(interaction: ChatInputCommandInteraction, deps: DispatchDeps): Promise<void>`
  - `extractGuildId(args: readonly unknown[]): string | null`
  - `bindEvents(client: Pick<Client, 'on' | 'once'>, registry: Registry, deps: { isModuleEnabled: DispatchDeps['isModuleEnabled']; log: Logger }): void`

- [ ] **Step 1: Write the failing test `tests/core/dispatch.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { Cooldowns } from '../../src/core/cooldowns.js';
import { handleCommand, type DispatchDeps } from '../../src/core/dispatch.js';
import { UserError } from '../../src/core/errors.js';
import { buildRegistry } from '../../src/core/loader.js';
import type { Command } from '../../src/core/types.js';
import { asInteraction, fakeCommand, fakeInteraction, fakeModule, lastEmbed, silentLog, testEnv } from '../helpers.js';

function setup(cmd: Command, meta: { alwaysOn?: boolean } = {}, enabled = true) {
  const registry = buildRegistry([fakeModule('fun', [cmd], meta)]);
  const deps: DispatchDeps = {
    registry,
    env: testEnv(),
    cooldowns: new Cooldowns(() => 0),
    isModuleEnabled: vi.fn(async () => enabled),
    log: silentLog(),
  };
  return { deps };
}

describe('handleCommand', () => {
  it('runs the command with context', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).toHaveBeenCalledWith({ interaction: i, registry: deps.registry, env: deps.env });
  });

  it('answers unknown commands', async () => {
    const { deps } = setup(fakeCommand('ping'));
    const i = fakeInteraction({ commandName: 'gone' });
    await handleCommand(asInteraction(i), deps);
    expect(lastEmbed(i.reply).description).toMatch(/don't know that command/);
  });

  it('blocks commands from modules disabled in the guild', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd, {}, false);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).not.toHaveBeenCalled();
    expect(lastEmbed(i.reply).description).toMatch(/fun module is disabled/);
  });

  it('ignores toggles for alwaysOn modules', async () => {
    const cmd = fakeCommand('ping');
    const { deps } = setup(cmd, { alwaysOn: true }, false);
    await handleCommand(asInteraction(fakeInteraction()), deps);
    expect(cmd.run).toHaveBeenCalled();
  });

  it('enforces access rules', async () => {
    const cmd = fakeCommand('ping', { ownerOnly: true });
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(cmd.run).not.toHaveBeenCalled();
    expect(lastEmbed(i.reply).description).toMatch(/owner/);
  });

  it('applies cooldowns to everyone but owners', async () => {
    const cmd = fakeCommand('ping', { cooldownSeconds: 10 });
    const { deps } = setup(cmd);
    await handleCommand(asInteraction(fakeInteraction()), deps);
    const second = fakeInteraction();
    await handleCommand(asInteraction(second), deps);
    expect(cmd.run).toHaveBeenCalledTimes(1);
    expect(lastEmbed(second.reply).description).toMatch(/Try again in 10s/);

    await handleCommand(asInteraction(fakeInteraction({ user: { id: 'owner' } })), deps);
    await handleCommand(asInteraction(fakeInteraction({ user: { id: 'owner' } })), deps);
    expect(cmd.run).toHaveBeenCalledTimes(3);
  });

  it('reports errors thrown by the command', async () => {
    const cmd = fakeCommand('ping', {
      run: async () => {
        throw new UserError('Nope.');
      },
    });
    const { deps } = setup(cmd);
    const i = fakeInteraction();
    await handleCommand(asInteraction(i), deps);
    expect(lastEmbed(i.reply).description).toContain('Nope.');
  });
});
```

- [ ] **Step 2: Write the failing test `tests/core/events.test.ts`**

```ts
import { EventEmitter } from 'node:events';
import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { bindEvents, extractGuildId } from '../../src/core/events.js';
import { buildRegistry } from '../../src/core/loader.js';
import type { EventHandler } from '../../src/core/types.js';
import { fakeModule, silentLog } from '../helpers.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('extractGuildId', () => {
  it('finds the guild id on common event args', () => {
    expect(extractGuildId([{ guildId: 'g1' }])).toBe('g1');
    expect(extractGuildId([{ guild: { id: 'g2' } }])).toBe('g2');
    expect(extractGuildId([{ message: { guildId: 'g3' } }, { id: 'user' }])).toBe('g3');
    expect(extractGuildId([{}, 'text', null])).toBeNull();
  });
});

describe('bindEvents', () => {
  function setup(enabled: boolean, alwaysOn = false) {
    const run = vi.fn();
    const handler: EventHandler = { name: 'messageCreate', run };
    const client = new EventEmitter();
    const log = silentLog();
    bindEvents(
      client as unknown as Pick<Client, 'on' | 'once'>,
      buildRegistry([fakeModule('levels', [], { alwaysOn }, [handler])]),
      { isModuleEnabled: async () => enabled, log },
    );
    return { client, run, log };
  }

  it('runs handlers for enabled modules', async () => {
    const { client, run } = setup(true);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).toHaveBeenCalledWith({ guildId: 'g1' });
  });

  it('skips handlers for modules disabled in that guild', async () => {
    const { client, run } = setup(false);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('always runs alwaysOn modules', async () => {
    const { client, run } = setup(false, true);
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(run).toHaveBeenCalled();
  });

  it('logs handler errors instead of crashing', async () => {
    const { client, run, log } = setup(true);
    run.mockImplementation(() => {
      throw new Error('boom');
    });
    client.emit('messageCreate', { guildId: 'g1' });
    await flush();
    expect(log.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/core/dispatch.test.ts tests/core/events.test.ts`
Expected: FAIL, cannot resolve the source modules

- [ ] **Step 4: Write `src/core/dispatch.ts`**

```ts
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Env } from '../env.js';
import type { Cooldowns } from './cooldowns.js';
import { err } from './embeds.js';
import { UserError, reportError } from './errors.js';
import type { Logger } from './log.js';
import { checkAccess } from './perms.js';
import { respond } from './reply.js';
import type { Registry } from './types.js';

export interface DispatchDeps {
  registry: Registry;
  env: Env;
  cooldowns: Cooldowns;
  isModuleEnabled: (guildId: string, module: string) => Promise<boolean>;
  log: Logger;
}

export async function handleCommand(interaction: ChatInputCommandInteraction, deps: DispatchDeps): Promise<void> {
  const entry = deps.registry.commands.get(interaction.commandName);
  if (!entry) {
    await respond(interaction, err("I don't know that command anymore. It may have been removed."));
    return;
  }
  const { command, module } = entry;
  const userId = interaction.user.id;

  try {
    const guildId = interaction.inGuild() ? interaction.guildId : null;
    if (guildId && !module.alwaysOn && !(await deps.isModuleEnabled(guildId, module.name))) {
      throw new UserError(`The ${module.name} module is disabled in this server.`);
    }

    const denied = checkAccess(command, {
      userId,
      ownerIds: deps.env.ownerIds,
      inGuild: guildId !== null,
      has: (permission) => interaction.memberPermissions?.has(permission) ?? false,
    });
    if (denied) throw new UserError(denied);

    if (command.cooldownSeconds && !deps.env.ownerIds.includes(userId)) {
      const left = deps.cooldowns.hit(`${command.data.name}:${userId}`, command.cooldownSeconds);
      if (left > 0) throw new UserError(`Slow down. Try again in ${left}s.`);
    }

    await command.run({ interaction, registry: deps.registry, env: deps.env });
  } catch (error) {
    await reportError(interaction, error, deps.log);
  }
}
```

- [ ] **Step 5: Write `src/core/events.ts`**

```ts
import type { Client } from 'discord.js';
import type { Logger } from './log.js';
import type { Registry } from './types.js';

interface MaybeGuildScoped {
  guildId?: unknown;
  guild?: { id?: unknown } | null;
  message?: { guildId?: unknown } | null;
}

/** Best-effort guild lookup across discord.js event args (messages, members, reactions, states). */
export function extractGuildId(args: readonly unknown[]): string | null {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const a = arg as MaybeGuildScoped;
    if (typeof a.guildId === 'string') return a.guildId;
    if (a.guild && typeof a.guild.id === 'string') return a.guild.id;
    if (a.message && typeof a.message.guildId === 'string') return a.message.guildId;
  }
  return null;
}

export function bindEvents(
  client: Pick<Client, 'on' | 'once'>,
  registry: Registry,
  deps: { isModuleEnabled: (guildId: string, module: string) => Promise<boolean>; log: Logger },
): void {
  for (const mod of registry.modules) {
    for (const handler of mod.events) {
      const listener = async (...args: unknown[]): Promise<void> => {
        try {
          const guildId = extractGuildId(args);
          if (guildId && !mod.meta.alwaysOn && !(await deps.isModuleEnabled(guildId, mod.meta.name))) return;
          await (handler.run as (...a: unknown[]) => unknown)(...args);
        } catch (error) {
          deps.log.error(`event ${handler.name} in ${mod.meta.name} failed`, error);
        }
      };
      if (handler.once) client.once(handler.name, listener);
      else client.on(handler.name, listener);
    }
  }
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 7: Commit**

```bash
git add src/core/dispatch.ts src/core/events.ts tests/core/dispatch.test.ts tests/core/events.test.ts
git commit -m "add command dispatch and module-aware event binding"
```

---

### Task 7: DB-backed job scheduler

**Files:**
- Create: `src/core/scheduler.ts`
- Test: `tests/core/scheduler.test.ts`

**Interfaces:**
- Consumes: `prisma`, `JobHandler`, `Logger`
- Produces:
  - `scheduleJob(type: string, runAt: Date, payload: unknown, guildId?: string): Promise<number>`
  - `class Scheduler { constructor(opts: SchedulerOptions); recoverStale(): Promise<number>; tick(): Promise<number>; start(): void; stop(): void }`
  - `interface SchedulerOptions { handlers: JobHandler[]; log: Logger; intervalMs?: number; maxAttempts?: number; batchSize?: number; now?: () => Date }`
  - Retry policy: failed runs go back to `pending` with `runAt = now + attempts * 60s` until `maxAttempts` (default 3), then `failed`.

- [ ] **Step 1: Write the failing test `tests/core/scheduler.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db.js';
import { Scheduler, scheduleJob } from '../../src/core/scheduler.js';
import type { JobHandler } from '../../src/core/types.js';
import { resetDb } from '../db.js';
import { silentLog } from '../helpers.js';

const base = new Date('2026-01-01T00:00:00Z');
const secondsFrom = (s: number) => new Date(base.getTime() + s * 1000);

describe('Scheduler', () => {
  beforeEach(resetDb);

  function make(handlers: JobHandler[], clock = { now: base }) {
    return new Scheduler({ handlers, log: silentLog(), maxAttempts: 2, now: () => clock.now });
  }

  it('runs due jobs with their payload and marks them done', async () => {
    const run = vi.fn(async () => {});
    const id = await scheduleJob('test.ping', secondsFrom(-1), { hello: 'world' }, 'g1');
    expect(await make([{ type: 'test.ping', run }]).tick()).toBe(1);
    expect(run).toHaveBeenCalledWith({ hello: 'world' }, { id, guildId: 'g1' });
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('done');
  });

  it('leaves future jobs alone', async () => {
    const run = vi.fn(async () => {});
    await scheduleJob('test.ping', secondsFrom(60), null);
    expect(await make([{ type: 'test.ping', run }]).tick()).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('retries with backoff, then fails after maxAttempts', async () => {
    const clock = { now: base };
    const flaky: JobHandler = {
      type: 'test.flaky',
      run: async () => {
        throw new Error('nope');
      },
    };
    const scheduler = make([flaky], clock);
    const id = await scheduleJob('test.flaky', secondsFrom(-1), null);

    await scheduler.tick();
    let row = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'nope' });
    expect(row.runAt).toEqual(secondsFrom(60));

    expect(await scheduler.tick()).toBe(0);

    clock.now = secondsFrom(61);
    await scheduler.tick();
    row = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('fails jobs with no registered handler', async () => {
    const id = await scheduleJob('test.orphan', secondsFrom(-1), null);
    await make([]).tick();
    const row = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/No handler/);
  });

  it('resets jobs left running by a crash', async () => {
    const id = await scheduleJob('test.ping', secondsFrom(-1), null);
    await prisma.job.update({ where: { id }, data: { status: 'running' } });
    expect(await make([]).recoverStale()).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
  });

  it('rejects duplicate handler types', () => {
    const handler: JobHandler = { type: 'test.ping', run: async () => {} };
    expect(() => make([handler, handler])).toThrow(/Duplicate job handler/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/scheduler.test.ts`
Expected: FAIL, cannot resolve `../../src/core/scheduler.js`

- [ ] **Step 3: Write `src/core/scheduler.ts`**

```ts
import { prisma } from '../db.js';
import type { Logger } from './log.js';
import type { JobHandler } from './types.js';

export async function scheduleJob(type: string, runAt: Date, payload: unknown, guildId?: string): Promise<number> {
  const row = await prisma.job.create({
    data: { type, runAt, payload: JSON.stringify(payload ?? null), guildId: guildId ?? null },
  });
  return row.id;
}

export interface SchedulerOptions {
  handlers: JobHandler[];
  log: Logger;
  intervalMs?: number;
  maxAttempts?: number;
  batchSize?: number;
  now?: () => Date;
}

const RETRY_STEP_MS = 60_000;

export class Scheduler {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly opts: SchedulerOptions) {
    for (const handler of opts.handlers) {
      if (this.handlers.has(handler.type)) throw new Error(`Duplicate job handler: ${handler.type}`);
      this.handlers.set(handler.type, handler);
    }
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Jobs marked running when the process died never finished; make them eligible again. */
  async recoverStale(): Promise<number> {
    const result = await prisma.job.updateMany({ where: { status: 'running' }, data: { status: 'pending' } });
    return result.count;
  }

  /** Runs due jobs once. Returns how many were attempted. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const due = await prisma.job.findMany({
        where: { status: 'pending', runAt: { lte: this.now() } },
        orderBy: { runAt: 'asc' },
        take: this.opts.batchSize ?? 50,
      });
      let attempted = 0;
      for (const job of due) {
        const claimed = await prisma.job.updateMany({
          where: { id: job.id, status: 'pending' },
          data: { status: 'running', attempts: { increment: 1 } },
        });
        if (claimed.count === 0) continue;
        await this.execute(job.id, job.type, job.payload, job.guildId, job.attempts + 1);
        attempted++;
      }
      return attempted;
    } finally {
      this.ticking = false;
    }
  }

  private async execute(id: number, type: string, payload: string, guildId: string | null, attempts: number) {
    const handler = this.handlers.get(type);
    if (!handler) {
      await prisma.job.update({ where: { id }, data: { status: 'failed', lastError: `No handler for job type ${type}` } });
      this.opts.log.warn(`job ${id}: no handler for ${type}`);
      return;
    }
    try {
      await handler.run(JSON.parse(payload), { id, guildId });
      await prisma.job.update({ where: { id }, data: { status: 'done' } });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      if (attempts >= (this.opts.maxAttempts ?? 3)) {
        await prisma.job.update({ where: { id }, data: { status: 'failed', lastError } });
        this.opts.log.error(`job ${id} (${type}) failed permanently`, error);
      } else {
        const runAt = new Date(this.now().getTime() + attempts * RETRY_STEP_MS);
        await prisma.job.update({ where: { id }, data: { status: 'pending', lastError, runAt } });
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.opts.log.error('scheduler tick failed', error));
    }, this.opts.intervalMs ?? 15_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/core/scheduler.ts tests/core/scheduler.test.ts
git commit -m "add db-backed job scheduler with retries"
```

---

### Task 8: Healthcheck HTTP server

**Files:**
- Create: `src/core/http.ts`
- Test: `tests/core/http.test.ts`

**Interfaces:**
- Produces: `buildServer(): FastifyInstance` with `GET /health` → `{ ok: true }`. Slice 2 adds webhook routes here.

- [ ] **Step 1: Write the failing test `tests/core/http.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/core/http.js';

describe('buildServer', () => {
  it('answers the healthcheck', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/http.test.ts`
Expected: FAIL, cannot resolve `../../src/core/http.js`

- [ ] **Step 3: Write `src/core/http.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/core/http.ts tests/core/http.test.ts
git commit -m "add fastify healthcheck server"
```

---

### Task 9: Core module (/ping, /about, /help, /config)

**Files:**
- Create: `src/modules/core/index.ts`, `src/modules/core/commands/ping.ts`, `src/modules/core/commands/about.ts`, `src/modules/core/commands/help.ts`, `src/modules/core/commands/config.ts`, `src/modules/core/lib/format.ts`, `src/modules/core/lib/help.ts`, `src/modules/core/lib/config.ts`
- Test: `tests/modules/core/format.test.ts`, `tests/modules/core/help.test.ts`, `tests/modules/core/config.test.ts`

**Interfaces:**
- Consumes: `command`, `moduleMeta`, `info`, `ok`, `UserError`, `getDisabledModules`, `setModuleEnabled`, `Registry`
- Produces:
  - `formatUptime(totalSeconds: number): string`
  - `buildHelp(registry: Registry, disabled: ReadonlySet<string>, commandName?: string | null): EmbedBuilder`
  - `toggleModule(registry: Registry, guildId: string, name: string, enabled: boolean): Promise<void>`
  - `buildConfigView(registry: Registry, disabled: ReadonlySet<string>): EmbedBuilder`

`lib/` is not scanned by the loader, so pure helpers live there.

- [ ] **Step 1: Write the failing tests**

`tests/modules/core/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatUptime } from '../../../src/modules/core/lib/format.js';

describe('formatUptime', () => {
  it.each([
    [30, '<1m'],
    [90, '1m'],
    [3_660, '1h 1m'],
    [86_400, '1d'],
    [90_061, '1d 1h 1m'],
  ])('%i seconds -> %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });
});
```

`tests/modules/core/help.test.ts`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { buildRegistry } from '../../../src/core/loader.js';
import { buildHelp } from '../../../src/modules/core/lib/help.js';
import { fakeCommand, fakeModule } from '../../helpers.js';

const roll = fakeCommand('roll', {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice')
    .addIntegerOption((o) => o.setName('sides').setDescription('Number of sides')),
});

const registry = buildRegistry([
  fakeModule('core', [fakeCommand('ping'), fakeCommand('help')], { alwaysOn: true }),
  fakeModule('fun', [roll]),
  fakeModule('empty'),
]);

describe('buildHelp', () => {
  it('lists modules that have commands', () => {
    const fields = buildHelp(registry, new Set()).toJSON().fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['core', 'fun']);
    expect(fields[0]!.value).toContain('/ping');
  });

  it('hides modules disabled in the guild', () => {
    const fields = buildHelp(registry, new Set(['fun'])).toJSON().fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['core']);
  });

  it('shows one command in detail', () => {
    const json = buildHelp(registry, new Set(), '/roll').toJSON();
    expect(json.title).toBe('/roll');
    expect(json.description).toContain('Roll dice');
    expect(json.description).toContain('`sides` Number of sides');
  });

  it('rejects unknown commands', () => {
    expect(() => buildHelp(registry, new Set(), 'nope')).toThrow(UserError);
  });
});
```

`tests/modules/core/config.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { UserError } from '../../../src/core/errors.js';
import { isModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildRegistry } from '../../../src/core/loader.js';
import { buildConfigView, toggleModule } from '../../../src/modules/core/lib/config.js';
import { resetDb } from '../../db.js';
import { fakeModule } from '../../helpers.js';

const registry = buildRegistry([fakeModule('core', [], { alwaysOn: true }), fakeModule('fun')]);

describe('toggleModule', () => {
  beforeEach(resetDb);

  it('disables and enables a module', async () => {
    await toggleModule(registry, 'g1', 'fun', false);
    expect(await isModuleEnabled('g1', 'fun')).toBe(false);
    await toggleModule(registry, 'g1', 'fun', true);
    expect(await isModuleEnabled('g1', 'fun')).toBe(true);
  });

  it('rejects unknown modules and lists options', async () => {
    await expect(toggleModule(registry, 'g1', 'nope', false)).rejects.toThrow(/No module called nope. Options: fun/);
  });

  it('refuses to disable alwaysOn modules', async () => {
    await expect(toggleModule(registry, 'g1', 'core', false)).rejects.toBeInstanceOf(UserError);
  });
});

describe('buildConfigView', () => {
  it('marks each module on or off', () => {
    const description = buildConfigView(registry, new Set(['fun'])).toJSON().description ?? '';
    expect(description).toContain('● **core** (always on)');
    expect(description).toContain('○ **fun**');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/modules/core`
Expected: FAIL, cannot resolve the lib modules

- [ ] **Step 3: Write `src/modules/core/lib/format.ts`**

```ts
export function formatUptime(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const parts = [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '<1m';
}
```

- [ ] **Step 4: Write `src/modules/core/lib/help.ts`**

```ts
import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import type { Registry } from '../../../core/types.js';

export function buildHelp(registry: Registry, disabled: ReadonlySet<string>, commandName?: string | null): EmbedBuilder {
  if (commandName) {
    const name = commandName.replace(/^\//, '').toLowerCase();
    const entry = registry.commands.get(name);
    if (!entry) throw new UserError(`No command called /${name}.`);
    const json = entry.command.data.toJSON();
    const options = (json.options ?? []).map((o) => `\`${o.name}\` ${o.description}`);
    return info([json.description, ...options].join('\n'), `/${json.name}`).setFooter({ text: `Module: ${entry.module.name}` });
  }

  const embed = info('Run `/help command:<name>` for details on one command.', 'guiBot commands');
  for (const mod of registry.modules) {
    if (mod.commands.length === 0) continue;
    if (!mod.meta.alwaysOn && disabled.has(mod.meta.name)) continue;
    embed.addFields({ name: mod.meta.name, value: mod.commands.map((c) => `/${c.data.name}`).join(' ') });
  }
  return embed;
}
```

- [ ] **Step 5: Write `src/modules/core/lib/config.ts`**

```ts
import type { EmbedBuilder } from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { setModuleEnabled } from '../../../core/guildConfig.js';
import type { Registry } from '../../../core/types.js';

export async function toggleModule(registry: Registry, guildId: string, name: string, enabled: boolean): Promise<void> {
  const mod = registry.modules.find((m) => m.meta.name === name);
  if (!mod) {
    const options = registry.modules.filter((m) => !m.meta.alwaysOn).map((m) => m.meta.name);
    throw new UserError(`No module called ${name}. Options: ${options.join(', ') || 'none'}.`);
  }
  if (mod.meta.alwaysOn) throw new UserError(`${name} can't be turned off.`);
  await setModuleEnabled(guildId, name, enabled);
}

export function buildConfigView(registry: Registry, disabled: ReadonlySet<string>): EmbedBuilder {
  const lines = registry.modules.map((m) => {
    const on = m.meta.alwaysOn || !disabled.has(m.meta.name);
    const suffix = m.meta.alwaysOn ? ' (always on)' : '';
    return `${on ? '●' : '○'} **${m.meta.name}**${suffix}: ${m.meta.description}`;
  });
  return info(lines.join('\n'), 'Server config').setFooter({ text: 'Toggle with /config modules enable|disable' });
}
```

- [ ] **Step 6: Run the lib tests**

Run: `npx vitest run tests/modules/core`
Expected: all PASS

- [ ] **Step 7: Write `src/modules/core/index.ts`**

```ts
import { moduleMeta } from '../../core/define.js';

export default moduleMeta({ name: 'core', description: 'Help, bot info, and server config.', alwaysOn: true });
```

- [ ] **Step 8: Write `src/modules/core/commands/ping.ts`**

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('ping').setDescription('Check if guiBot is awake.'),
  cooldownSeconds: 5,
  async run({ interaction }) {
    const roundtrip = Date.now() - interaction.createdTimestamp;
    await interaction.reply({
      embeds: [info(`Pong. Gateway ${interaction.client.ws.ping}ms, roundtrip ${roundtrip}ms.`)],
    });
  },
});
```

- [ ] **Step 9: Write `src/modules/core/commands/about.ts`**

`../../../../package.json` resolves to the repo root from both `src/modules/core/commands/` and `dist/modules/core/commands/`.

```ts
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
```

- [ ] **Step 10: Write `src/modules/core/commands/help.ts`**

```ts
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { getDisabledModules } from '../../../core/guildConfig.js';
import { buildHelp } from '../lib/help.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List commands, or get details on one.')
    .addStringOption((o) => o.setName('command').setDescription('Command name, like ping')),
  async run({ interaction, registry }) {
    const disabled = interaction.inGuild() ? await getDisabledModules(interaction.guildId) : new Set<string>();
    const embed = buildHelp(registry, disabled, interaction.options.getString('command'));
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});
```

- [ ] **Step 11: Write `src/modules/core/commands/config.ts`**

```ts
import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { getDisabledModules } from '../../../core/guildConfig.js';
import { buildConfigView, toggleModule } from '../lib/config.js';

export default command({
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or change guiBot settings for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('view').setDescription('Show current settings.'))
    .addSubcommandGroup((g) =>
      g
        .setName('modules')
        .setDescription('Turn modules on or off.')
        .addSubcommand((s) =>
          s
            .setName('enable')
            .setDescription('Turn a module on.')
            .addStringOption((o) => o.setName('module').setDescription('Module name').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('disable')
            .setDescription('Turn a module off.')
            .addStringOption((o) => o.setName('module').setDescription('Module name').setRequired(true)),
        ),
    ),
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,
  async run({ interaction, registry }) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;

    if (interaction.options.getSubcommandGroup(false) === 'modules') {
      const name = interaction.options.getString('module', true).trim().toLowerCase();
      const enabled = interaction.options.getSubcommand() === 'enable';
      await toggleModule(registry, guildId, name, enabled);
      await interaction.reply({
        embeds: [ok(`${name} is now ${enabled ? 'on' : 'off'} in this server.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const view = buildConfigView(registry, await getDisabledModules(guildId));
    await interaction.reply({ embeds: [view], flags: MessageFlags.Ephemeral });
  },
});
```

- [ ] **Step 12: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 13: Commit**

```bash
git add src/modules/core tests/modules/core
git commit -m "add core module with ping, about, help, and config"
```

---

### Task 10: Entry point and command deployment

**Files:**
- Create: `src/core/deploy.ts`, `src/deploy.ts`, `src/index.ts`
- Test: `tests/core/deploy.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `commandPayload(registry: Registry): RESTPostAPIChatInputApplicationCommandsJSONBody[]`
  - `deployCommands(env: Env, registry: Registry): Promise<{ count: number; scope: string }>`
  - `npm run deploy` registers commands; `npm run dev` runs the bot

- [ ] **Step 1: Write the failing test `tests/core/deploy.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { commandPayload } from '../../src/core/deploy.js';
import { buildRegistry } from '../../src/core/loader.js';
import { fakeCommand, fakeModule } from '../helpers.js';

describe('commandPayload', () => {
  it('serializes every registered command', () => {
    const registry = buildRegistry([
      fakeModule('core', [fakeCommand('ping'), fakeCommand('help')]),
      fakeModule('fun', [fakeCommand('roll')]),
    ]);
    expect(commandPayload(registry).map((c) => c.name)).toEqual(['ping', 'help', 'roll']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/deploy.test.ts`
Expected: FAIL, cannot resolve `../../src/core/deploy.js`

- [ ] **Step 3: Write `src/core/deploy.ts`**

```ts
import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Env } from '../env.js';
import type { Registry } from './types.js';

export function commandPayload(registry: Registry): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [...registry.commands.values()].map(({ command }) => command.data.toJSON());
}

/** Guild-scoped (instant) in dev when DEV_GUILD_ID is set, global otherwise. */
export async function deployCommands(env: Env, registry: Registry): Promise<{ count: number; scope: string }> {
  const body = commandPayload(registry);
  const rest = new REST().setToken(env.discordToken);
  const guildId = env.isProduction ? undefined : env.devGuildId;
  const route = guildId
    ? Routes.applicationGuildCommands(env.clientId, guildId)
    : Routes.applicationCommands(env.clientId);
  await rest.put(route, { body });
  return { count: body.length, scope: guildId ? `guild ${guildId}` : 'global' };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/core/deploy.test.ts`
Expected: PASS

- [ ] **Step 5: Write `src/deploy.ts`**

```ts
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
```

- [ ] **Step 6: Write `src/index.ts`**

```ts
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
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build && ls dist/modules/core/commands`
Expected: clean, and `about.js config.js help.js ping.js` (plus `.map` files) listed

- [ ] **Step 8: Smoke test against Discord (Gui runs this)**

Needs real credentials, so the implementer stops here and hands off:
1. In the Discord Developer Portal, bot settings: turn on Server Members Intent and Message Content Intent.
2. Add `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DEV_GUILD_ID`, `OWNER_IDS`, `DATABASE_URL=file:./dev.db` to `.env` (see `.env.example`).
3. Run `npm run deploy`. Expected log: `Deployed 4 commands (guild <id>)`.
4. Run `npm run dev`. Expected: `Loaded modules: core`, `HTTP listening on 3000`, `Ready as guiBot#....`
5. In the dev server: `/ping` answers, `/help` lists core, `/about` shows version 0.1.0, `/config view` shows core as always on, `/config modules disable core` answers "core can't be turned off."
6. `curl localhost:3000/health` returns `{"ok":true}`.

- [ ] **Step 9: Commit**

```bash
git add src/core/deploy.ts src/deploy.ts src/index.ts tests/core/deploy.test.ts
git commit -m "wire entry point, dispatch, scheduler, and command deploy"
```

---

### Task 11: Docker, Railway, README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.json`
- Replace: `README.md`

**Interfaces:**
- Consumes: `npm run build` output in `dist/`, `prisma/migrations`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
# exec so node receives SIGTERM from Railway directly.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/deploy.js && exec node dist/index.js"]
```

`prisma` is copied before `npm ci` so `@prisma/client`'s postinstall generates the client.

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.env
.git
legacy
tests
docs
prisma/*.db
prisma/*.db-journal
debug_*.html
```

- [ ] **Step 3: Write `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE" },
  "deploy": { "healthcheckPath": "/health", "restartPolicyType": "ON_FAILURE" }
}
```

- [ ] **Step 4: Replace `README.md`**

````markdown
# guiBot

My personal everything bot for Discord. It runs my servers and keeps track of how my Senior Design team is doing.

## Develop

```bash
cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID, OWNER_IDS
npm install
npm run db:migrate     # creates prisma/dev.db
npm run deploy         # registers slash commands in DEV_GUILD_ID
npm run dev
npm test
```

In the Discord Developer Portal, turn on the Server Members and Message Content intents.

## Add a command

Create one file in `src/modules/<module>/commands/`, then run `npm run deploy`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('hello').setDescription('Say hi.'),
  async run({ interaction }) {
    await interaction.reply({ embeds: [info('hi')] });
  },
});
```

To add a module, create `src/modules/<name>/index.ts` that exports `moduleMeta({ name, description })`. Put event handlers in `events/` and scheduled job handlers in `jobs/`.

## Deploy (Railway)

- Deploy from this repo. Railway builds from `Dockerfile`.
- Add a volume mounted at `/data`.
- Set these env vars: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OWNER_IDS`, `DATABASE_URL=file:/data/guibot.db`, `NODE_ENV=production`. Set `ENABLED_MODULES` too if you want to limit which modules load.
- On boot the container runs migrations, registers global commands, then starts the bot. The healthcheck is `GET /health`.

The old PrizePicks tracker lives in `legacy/prizepicks/` until it's ported as a module.
````

- [ ] **Step 5: Verify the image builds (skip if Docker isn't installed)**

Run: `docker build -t guibot .`
Expected: build succeeds

- [ ] **Step 6: Final full check**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS, clean

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore railway.json README.md
git commit -m "add docker and railway deploy config"
```
