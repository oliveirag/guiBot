# guiBot Webhooks (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dev` module that receives signed GitHub and Jira webhooks, stores every event for later slices (Senior Design `/progress` and the weekly digest), and posts the ones people care about to the channels each server picked with `/config dev`.

**Architecture:** Three small core extensions come first: modules can add a `/config <module>` subcommand group (`config.ts`), modules can mount HTTP routes (`routes/`), and job handlers get the Discord client. The `dev` module then has two webhook routes. Each one checks the HMAC signature on the raw body, turns the payload into `NormalizedEvent`s, and calls `ingest()`. `ingest()` dedupes by delivery id, stores `DevEvent` rows, and queues one `dev.notify` job per subscribed channel, all in one transaction. The `dev.notify` job renders a branded embed and posts it. The scheduler handles retries.

**Tech Stack:** TypeScript 5.9 (ESM, NodeNext), Node 22, discord.js v14, Prisma 6 + SQLite, Fastify 5, zod 4, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-21-guibot-design.md` (see "Dev notifications", "Public-ready constraints", "Env vars"). Builds on `docs/superpowers/plans/2026-09-22-guibot-core.md`.

## Global Constraints

- Node 22, ESM, relative imports end in `.js`. Prisma stays on `^6`.
- Dev notifications are webhooks only and signature-verified: GitHub workflow runs, PR opened/merged, releases; Jira issue created/transitioned/assigned.
- No hardcoded guild, channel, role, or user IDs. Feed routing comes from per-guild DB rows.
- Guild-scoped rows are keyed by `guildId`. `DevEvent` is global (one row per incoming event) on purpose. Later slices read it.
- Per-guild module toggles: a guild with `dev` disabled gets no posts and can't use `/config dev`.
- `ENABLED_MODULES` leaves out a module → its commands, events, jobs, routes, and config section are never loaded.
- Config goes through `/config <module>` subcommands (the user picked this over a standalone `/devfeed` command).
- Feeds are keyed by GitHub `owner/repo` (stored lowercased) or Jira project key (stored uppercased), each mapped to one channel per guild.
- Job types are namespaced `<module>.<name>` (`dev.notify`).
- Brand accent `0x3b82f6`, errors `0xef4444`. Voice: clean, minimal, lightly playful. No em dashes in user-facing copy.
- Env vars added: `GITHUB_WEBHOOK_SECRET`, `JIRA_WEBHOOK_SECRET` (both optional; an unset secret makes its route answer 503).
- Commit messages: one lowercase line, no `feat:`/`fix:` prefix, no body, no co-author or session trailers.
- Never print or commit `.env`.

## Review Focus

1. **Redelivered webhooks** (GitHub "Redeliver" button, Jira retries with the same `X-Atlassian-Webhook-Identifier`) should post once, not twice. Pinned in Task 7 (`dedupes a redelivered webhook`).
2. **A feed channel that got deleted, or that the bot lost access to**, should not spin through retries forever. A deleted channel removes its feeds; missing perms logs and drops that one post. Pinned in Task 8 (`drops feeds for a deleted channel`, `gives up quietly without permission`).
3. **Big push payloads** (hundreds of commits, over Fastify's 1 MB default) should be accepted, not 413'd. Pinned in Task 3 (`accepts bodies over 1 MB`).
4. **Long PR or issue titles** (over 256 chars) should be clipped, not make Discord reject the embed and fail the job. Pinned in Task 8 (`clips long titles`).
5. **A misconfigured sender** (unset secret, form-encoded GitHub webhook, garbage body) should get a clear 4xx/503 and not crash. Pinned in Task 7 (`answers 503 when the secret is unset`, `rejects non-JSON bodies`, `rejects invalid JSON and a missing delivery id`).

## File Structure

```
prisma/schema.prisma                    + DevFeed, DevEvent
src/
  env.ts                                + githubWebhookSecret, jiraWebhookSecret
  index.ts                              pass client to Scheduler, module routes to buildServer
  core/
    types.ts                            + ConfigSection, HttpDeps, HttpRoutes; JobContext.client;
                                          Command.dataFor; LoadedModule.config/routes
    define.ts                           + configSection(), routes()
    loader.ts                           loads <module>/config.ts and <module>/routes/*
    scheduler.ts                        scheduleJob(db?), client in JobContext, attempt-aware recoverStale
    http.ts                             buildServer(opts?) mounts module routes; acceptRawJson()
  modules/core/
    commands/config.ts                  dispatches /config <module> groups to sections
    lib/config.ts                       configCommandData(), runConfigSection(), sectionSummaries()
  modules/dev/
    index.ts                            module meta
    config.ts                           /config dev add|remove|list
    routes/github.ts                    POST /webhooks/github
    routes/jira.ts                      POST /webhooks/jira
    jobs/notify.ts                      dev.notify: post one event to one channel
    lib/types.ts                        FeedSource, DevEventKind, NormalizedEvent, NOTIFY_KINDS
    lib/feeds.ts                        feed CRUD + target normalization + canPost()
    lib/signature.ts                    verifySignature(), signBody()
    lib/github.ts                       normalizeGithub()
    lib/jira.ts                         normalizeJira()
    lib/ingest.ts                       ingest(): dedupe, store, queue notify jobs
    lib/webhook.ts                      webhookHandler(): shared route logic
    lib/render.ts                       renderEvent(): DevEvent -> embed
tests/
  helpers.ts                            fakeModule() gets config/routes
  db.ts                                 resetDb() clears new tables
  fixtures/modules/beta/config.ts, beta/routes/hello.ts
  core/scheduler.test.ts, loader.test.ts, http.test.ts (extended)
  env.test.ts (extended)
  modules/core/config.test.ts (extended)
  modules/dev/feeds.test.ts, signature.test.ts, github.test.ts, jira.test.ts,
    webhooks.test.ts, notify.test.ts
README.md, .env.example
```

Out of scope: Senior Design views over `DevEvent` (slice 3), notifying on workflow success or "back to green" (only failures post), event retention/pruning, and GitHub App auth.

---

### Task 1: Scheduler upgrades for real job handlers

Job handlers need the Discord client to post. `ingest()` needs to queue jobs inside its own transaction. And `recoverStale` must stop re-queuing jobs that already used all their attempts (a job that crashes the process would otherwise loop forever).

**Files:**
- Modify: `src/core/types.ts` (JobContext)
- Modify: `src/core/scheduler.ts`
- Modify: `src/index.ts`
- Test: `tests/core/scheduler.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `JobContext { id: number; guildId: string | null; client: Client }`
  - `scheduleJob(type: string, runAt: Date, payload: unknown, guildId?: string, db?: Prisma.TransactionClient): Promise<number>`
  - `SchedulerOptions.client: Client` (required)
  - `Scheduler.recoverStale(): Promise<{ requeued: number; failed: number }>`

- [ ] **Step 1: Update the scheduler tests**

In `tests/core/scheduler.test.ts`:

Add `import type { Client } from 'discord.js';` to the imports and a shared fake right after the `secondsFrom` line:

```ts
const client = { fake: 'client' } as unknown as Client;
```

Replace the `make` helper with:

```ts
  function make(handlers: JobHandler[], clock = { now: base }) {
    return new Scheduler({ handlers, log: silentLog(), maxAttempts: 2, now: () => clock.now, client });
  }
```

In `runs due jobs with their payload and marks them done`, replace the `toHaveBeenCalledWith` line with:

```ts
    expect(run).toHaveBeenCalledWith({ hello: 'world' }, { id, guildId: 'g1', client });
```

In `times out a handler that never resolves...` and `waits for an in-flight tick before stop resolves`, add `client` to the `new Scheduler({ ... })` options object.

Replace the `resets jobs left running by a crash` test with:

```ts
  it('resets jobs left running by a crash', async () => {
    const id = await scheduleJob('test.ping', secondsFrom(-1), null);
    await prisma.job.update({ where: { id }, data: { status: 'running', attempts: 1 } });
    expect(await make([]).recoverStale()).toEqual({ requeued: 1, failed: 0 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
  });

  it('fails crashed jobs that already used every attempt instead of looping', async () => {
    const id = await scheduleJob('test.ping', secondsFrom(-1), null);
    await prisma.job.update({ where: { id }, data: { status: 'running', attempts: 2 } });
    expect(await make([]).recoverStale()).toEqual({ requeued: 0, failed: 1 });
    const row = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(/restart/);
  });

  it('schedules inside a caller transaction and rolls back with it', async () => {
    await prisma.$transaction(async (tx) => {
      await scheduleJob('test.ping', base, { a: 1 }, 'g1', tx);
    });
    expect(await prisma.job.count()).toBe(1);

    await expect(
      prisma.$transaction(async (tx) => {
        await scheduleJob('test.ping', base, { a: 2 }, 'g1', tx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await prisma.job.count()).toBe(1);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/core/scheduler.test.ts`
Expected: FAIL (`recoverStale` returns a number, and the handler isn't passed `client`).

- [ ] **Step 3: Add `client` to `JobContext`**

In `src/core/types.ts`, add `Client` to the `discord.js` type import and replace `JobContext`:

```ts
export interface JobContext {
  id: number;
  guildId: string | null;
  client: Client;
}
```

- [ ] **Step 4: Update `src/core/scheduler.ts`**

Replace the imports and `scheduleJob` at the top of the file with:

```ts
import type { Prisma } from '@prisma/client';
import type { Client } from 'discord.js';
import { prisma } from '../db.js';
import type { Logger } from './log.js';
import type { JobHandler } from './types.js';

/** Pass `db` to schedule inside a caller's transaction. */
export async function scheduleJob(
  type: string,
  runAt: Date,
  payload: unknown,
  guildId?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  const row = await db.job.create({
    data: { type, runAt, payload: JSON.stringify(payload ?? null), guildId: guildId ?? null },
  });
  return row.id;
}
```

Add `client: Client;` to `SchedulerOptions` (after `log`).

Replace `recoverStale` with:

```ts
  /**
   * Jobs marked running when the process died never finished. Re-queue them, unless they already
   * used every attempt (a job that keeps crashing the process would otherwise loop forever).
   */
  async recoverStale(): Promise<{ requeued: number; failed: number }> {
    const failed = await prisma.job.updateMany({
      where: { status: 'running', attempts: { gte: this.opts.maxAttempts ?? 3 } },
      data: { status: 'failed', lastError: 'Interrupted by a restart too many times' },
    });
    const requeued = await prisma.job.updateMany({ where: { status: 'running' }, data: { status: 'pending' } });
    return { requeued: requeued.count, failed: failed.count };
  }
```

In `execute`, change the handler call to:

```ts
        handler.run(JSON.parse(payload), { id, guildId, client: this.opts.client }),
```

- [ ] **Step 5: Update `src/index.ts`**

Replace the scheduler construction line with:

```ts
const scheduler = new Scheduler({ handlers: registry.modules.flatMap((m) => m.jobs), log, client });
```

Replace the recovery block inside `ClientReady` with:

```ts
  try {
    const { requeued, failed } = await scheduler.recoverStale();
    if (requeued > 0) log.warn(`Re-queued ${requeued} jobs interrupted by a restart`);
    if (failed > 0) log.warn(`Failed ${failed} jobs that kept getting interrupted`);
  } catch (error) {
    log.error('stale job recovery failed', error);
  }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/scheduler.ts src/index.ts tests/core/scheduler.test.ts
git commit -m "give jobs the client and stop requeuing exhausted jobs on boot"
```

---

### Task 2: Module config sections (`/config <module>`)

A module can ship `config.ts` exporting a `ConfigSection`. `/config` then grows a subcommand group named after the module, `/config view` shows each section's one-line summary, and running a group in a guild where the module is off gives a clear error.

`/config`'s slash data depends on which modules loaded, so commands get an optional `dataFor(modules)` hook. `buildRegistry` resolves it once, which means deploy and `/help` keep reading `command.data` unchanged.

**Files:**
- Modify: `src/core/types.ts`, `src/core/define.ts`, `src/core/loader.ts`
- Modify: `src/modules/core/lib/config.ts`, `src/modules/core/commands/config.ts`
- Modify: `tests/helpers.ts`
- Create: `tests/fixtures/modules/beta/config.ts`
- Test: `tests/core/loader.test.ts`, `tests/modules/core/config.test.ts`

**Interfaces:**
- Consumes: `CommandContext`, `Registry`, `isModuleEnabled(guildId, module)` from slice 1.
- Produces:
  - `interface ConfigSection { build(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder; run(ctx: CommandContext): Promise<void>; view?(guildId: string): Promise<string> }`
  - `Command.dataFor?(modules: LoadedModule[]): CommandData`
  - `LoadedModule.config: ConfigSection | null`
  - `configSection(c: ConfigSection): ConfigSection` in `src/core/define.ts`
  - `configCommandData(modules: LoadedModule[])`, `runConfigSection(ctx, guildId, group, isEnabled)`, `sectionSummaries(registry, guildId, disabled)`, `buildConfigView(registry, disabled, summaries?)` in `src/modules/core/lib/config.ts`

- [ ] **Step 1: Add the fixture and update helpers**

Create `tests/fixtures/modules/beta/config.ts`:

```ts
import { configSection } from '../../../../src/core/define.js';

export default configSection({
  build: (g) => g.addSubcommand((s) => s.setName('show').setDescription('Show beta settings.')),
  async run() {},
});
```

In `tests/helpers.ts`, change the `fakeModule` return to:

```ts
  return { meta: { name, description: `${name} module`, ...meta }, commands, events, jobs: [], config: null };
```

- [ ] **Step 2: Write the failing loader tests**

In `tests/core/loader.test.ts`, add `import { SlashCommandBuilder } from 'discord.js';` to the imports. Inside `loads every module folder that has an index`, append:

```ts
    expect(modules[0]!.config).toBeNull();
    expect(beta.config?.build).toBeTypeOf('function');
```

Add to the `buildRegistry` describe:

```ts
  it('lets a command build its data from every loaded module', () => {
    const config = fakeCommand('config', {
      dataFor: (mods) =>
        new SlashCommandBuilder().setName('config').setDescription(mods.map((m) => m.meta.name).join(',')),
    });
    const registry = buildRegistry([fakeModule('core', [config]), fakeModule('dev')]);
    expect(registry.commands.get('config')!.command.data.toJSON().description).toBe('core,dev');
  });
```

- [ ] **Step 3: Write the failing config lib tests**

Replace `tests/modules/core/config.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { configSection } from '../../../src/core/define.js';
import { UserError } from '../../../src/core/errors.js';
import { isModuleEnabled, setModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildRegistry } from '../../../src/core/loader.js';
import type { CommandContext, LoadedModule, Registry } from '../../../src/core/types.js';
import {
  buildConfigView,
  configCommandData,
  runConfigSection,
  sectionSummaries,
  toggleModule,
} from '../../../src/modules/core/lib/config.js';
import { resetDb } from '../../db.js';
import { asInteraction, fakeInteraction, fakeModule, testEnv } from '../../helpers.js';

const registry = buildRegistry([fakeModule('core', [], { alwaysOn: true }), fakeModule('fun')]);

function withSection(name: string, run = vi.fn(async () => {})): LoadedModule {
  return {
    ...fakeModule(name),
    config: configSection({
      build: (g: SlashCommandSubcommandGroupBuilder) => g.addSubcommand((s) => s.setName('list').setDescription('List.')),
      run,
      view: async () => '2 feeds',
    }),
  };
}

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

describe('configCommandData', () => {
  it('adds a subcommand group per module with a config section', () => {
    const json = configCommandData([fakeModule('core'), withSection('dev')]).toJSON();
    expect(json.options?.map((o) => o.name)).toEqual(['view', 'modules', 'dev']);
  });

  it('refuses a module whose name collides with a built-in subcommand', () => {
    expect(() => configCommandData([withSection('modules')])).toThrow(/name is taken/);
  });
});

describe('runConfigSection', () => {
  beforeEach(resetDb);

  const ctxFor = (reg: Registry): CommandContext => ({
    interaction: asInteraction(fakeInteraction()),
    registry: reg,
    env: testEnv(),
  });

  it('runs the matching section', async () => {
    const run = vi.fn(async () => {});
    const ctx = ctxFor(buildRegistry([withSection('dev', run)]));
    await runConfigSection(ctx, 'g1', 'dev', isModuleEnabled);
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('refuses when the module is off in this guild', async () => {
    const run = vi.fn(async () => {});
    const ctx = ctxFor(buildRegistry([withSection('dev', run)]));
    await setModuleEnabled('g1', 'dev', false);
    await expect(runConfigSection(ctx, 'g1', 'dev', isModuleEnabled)).rejects.toThrow(/dev is off in this server/);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects groups with no section', async () => {
    await expect(runConfigSection(ctxFor(registry), 'g1', 'fun', isModuleEnabled)).rejects.toBeInstanceOf(UserError);
  });
});

describe('buildConfigView', () => {
  it('marks each module on or off', () => {
    const description = buildConfigView(registry, new Set(['fun'])).toJSON().description ?? '';
    expect(description).toContain('● **core** (always on)');
    expect(description).toContain('○ **fun**');
  });

  it('shows section summaries for enabled modules only', async () => {
    const reg = buildRegistry([withSection('dev'), withSection('sd')]);
    const summaries = await sectionSummaries(reg, 'g1', new Set(['sd']));
    expect([...summaries.keys()]).toEqual(['dev']);
    const description = buildConfigView(reg, new Set(['sd']), summaries).toJSON().description ?? '';
    expect(description).toContain('**dev**: dev module\n└ 2 feeds');
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/core/loader.test.ts tests/modules/core/config.test.ts`
Expected: FAIL (`configSection` not exported, `config` missing on loaded modules).

- [ ] **Step 5: Add the types**

In `src/core/types.ts`, add `SlashCommandSubcommandGroupBuilder` to the `discord.js` type import. Add `dataFor` to `Command`:

```ts
export interface Command extends AccessRules {
  data: CommandData;
  /** Builds slash data from every loaded module. Resolved once by buildRegistry, replacing `data`. */
  dataFor?(modules: LoadedModule[]): CommandData;
  cooldownSeconds?: number;
  run(ctx: CommandContext): Promise<void>;
}
```

Add after `ModuleMeta`:

```ts
/** A module's `/config <module>` subcommand group. Lives in `src/modules/<name>/config.ts`. */
export interface ConfigSection {
  build(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder;
  run(ctx: CommandContext): Promise<void>;
  /** One short line for /config view, like "2 feeds". */
  view?(guildId: string): Promise<string>;
}
```

Add `config: ConfigSection | null;` to `LoadedModule` (after `jobs`).

In `src/core/define.ts`, add `ConfigSection` to the type import and:

```ts
export const configSection = (c: ConfigSection): ConfigSection => c;
```

- [ ] **Step 6: Load `config.ts` and resolve `dataFor` in `src/core/loader.ts`**

Add `ConfigSection` to the type import. Replace `findIndex` with:

```ts
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
```

In `loadModules`, change `const index = await findIndex(dir);` to `const index = await findEntry(dir, 'index');`, and replace the `modules.push(...)` call with:

```ts
    const configFile = await findEntry(dir, 'config');
    modules.push({
      meta,
      commands: await importAll<Command>(join(dir, 'commands')),
      events: await importAll<EventHandler>(join(dir, 'events')),
      jobs: await importAll<JobHandler>(join(dir, 'jobs')),
      config: configFile ? await importDefault<ConfigSection>(configFile) : null,
    });
```

Replace the loop body in `buildRegistry` with:

```ts
    for (const cmd of mod.commands) {
      const resolved = cmd.dataFor ? { ...cmd, data: cmd.dataFor(modules) } : cmd;
      const existing = commands.get(resolved.data.name);
      if (existing) {
        throw new Error(`Duplicate command /${resolved.data.name} in ${existing.module.name} and ${mod.meta.name}`);
      }
      commands.set(resolved.data.name, { command: resolved, module: mod.meta });
    }
```

Update the doc comment on `loadModules` to: `/** Loads every \`root/<module>/index\` plus its commands/, events/, jobs/ folders and optional config. */`

- [ ] **Step 7: Replace `src/modules/core/lib/config.ts`**

```ts
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type EmbedBuilder,
} from 'discord.js';
import { info } from '../../../core/embeds.js';
import { UserError } from '../../../core/errors.js';
import { setModuleEnabled } from '../../../core/guildConfig.js';
import type { CommandContext, LoadedModule, Registry } from '../../../core/types.js';

// Built-in /config subcommands. A module with one of these names can't have a section.
const RESERVED = new Set(['view', 'modules']);

export function configCommandData(modules: LoadedModule[]) {
  const data = new SlashCommandBuilder()
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
    );
  for (const mod of modules) {
    const section = mod.config;
    if (!section) continue;
    if (RESERVED.has(mod.meta.name)) {
      throw new Error(`Module ${mod.meta.name} can't have a /config section: that name is taken`);
    }
    data.addSubcommandGroup((g) =>
      section.build(g.setName(mod.meta.name).setDescription(mod.meta.description.slice(0, 100))),
    );
  }
  return data;
}

export async function toggleModule(registry: Registry, guildId: string, name: string, enabled: boolean): Promise<void> {
  const mod = registry.modules.find((m) => m.meta.name === name);
  if (!mod) {
    const options = registry.modules.filter((m) => !m.meta.alwaysOn).map((m) => m.meta.name);
    throw new UserError(`No module called ${name}. Options: ${options.join(', ') || 'none'}.`);
  }
  if (mod.meta.alwaysOn) throw new UserError(`${name} can't be turned off.`);
  await setModuleEnabled(guildId, name, enabled);
}

export async function runConfigSection(
  ctx: CommandContext,
  guildId: string,
  group: string,
  isEnabled: (guildId: string, module: string) => Promise<boolean>,
): Promise<void> {
  const mod = ctx.registry.modules.find((m) => m.meta.name === group);
  if (!mod?.config) throw new UserError(`There are no settings called ${group}.`);
  if (!mod.meta.alwaysOn && !(await isEnabled(guildId, group))) {
    throw new UserError(`${group} is off in this server. Turn it on with /config modules enable.`);
  }
  await mod.config.run(ctx);
}

export async function sectionSummaries(
  registry: Registry,
  guildId: string,
  disabled: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  for (const mod of registry.modules) {
    if (!mod.config?.view) continue;
    if (!mod.meta.alwaysOn && disabled.has(mod.meta.name)) continue;
    summaries.set(mod.meta.name, await mod.config.view(guildId));
  }
  return summaries;
}

export function buildConfigView(
  registry: Registry,
  disabled: ReadonlySet<string>,
  summaries: ReadonlyMap<string, string> = new Map(),
): EmbedBuilder {
  const lines = registry.modules.map((m) => {
    const on = m.meta.alwaysOn || !disabled.has(m.meta.name);
    const suffix = m.meta.alwaysOn ? ' (always on)' : '';
    const summary = summaries.get(m.meta.name);
    return `${on ? '●' : '○'} **${m.meta.name}**${suffix}: ${m.meta.description}${summary ? `\n└ ${summary}` : ''}`;
  });
  return info(lines.join('\n'), 'Server config').setFooter({ text: 'Toggle with /config modules enable|disable' });
}
```

- [ ] **Step 8: Replace `src/modules/core/commands/config.ts`**

```ts
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command } from '../../../core/define.js';
import { ok } from '../../../core/embeds.js';
import { getDisabledModules, isModuleEnabled } from '../../../core/guildConfig.js';
import {
  buildConfigView,
  configCommandData,
  runConfigSection,
  sectionSummaries,
  toggleModule,
} from '../lib/config.js';

export default command({
  data: configCommandData([]),
  dataFor: configCommandData,
  guildOnly: true,
  memberPermissions: PermissionFlagsBits.ManageGuild,
  async run(ctx) {
    const { interaction, registry } = ctx;
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'modules') {
      const name = interaction.options.getString('module', true).trim().toLowerCase();
      const enabled = interaction.options.getSubcommand() === 'enable';
      await toggleModule(registry, guildId, name, enabled);
      await interaction.reply({
        embeds: [ok(`${name} is now ${enabled ? 'on' : 'off'} in this server.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (group) {
      await runConfigSection(ctx, guildId, group, isModuleEnabled);
      return;
    }

    const disabled = await getDisabledModules(guildId);
    const view = buildConfigView(registry, disabled, await sectionSummaries(registry, guildId, disabled));
    await interaction.reply({ embeds: [view], flags: MessageFlags.Ephemeral });
  },
});
```

- [ ] **Step 9: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass. If `data.addSubcommandGroup` in the loop complains about the builder type, annotate `data` as `SlashCommandSubcommandsOnlyBuilder` (import it from `discord.js`).

- [ ] **Step 10: Commit**

```bash
git add src/core src/modules/core tests/helpers.ts tests/fixtures/modules/beta/config.ts tests/core/loader.test.ts tests/modules/core/config.test.ts
git commit -m "let modules add their own /config sections"
```

---

### Task 3: Module HTTP routes and webhook secrets

Modules can mount Fastify routes from `routes/*.ts`. Each file gets its own encapsulated Fastify scope, so the `dev` module can swap the JSON parser for a raw-Buffer one (needed for HMAC) without touching `/health`. Webhook secrets come from env.

**Files:**
- Modify: `src/core/types.ts`, `src/core/define.ts`, `src/core/loader.ts`, `src/core/http.ts`
- Modify: `src/env.ts`, `src/index.ts`, `.env.example`
- Modify: `tests/helpers.ts`
- Create: `tests/fixtures/modules/beta/routes/hello.ts`
- Test: `tests/core/http.test.ts`, `tests/core/loader.test.ts`, `tests/env.test.ts`

**Interfaces:**
- Consumes: `Env`, `Logger`.
- Produces:
  - `interface HttpDeps { env: Env; log: Logger }`
  - `type HttpRoutes = (app: FastifyInstance, deps: HttpDeps) => Promise<void>`
  - `LoadedModule.routes: HttpRoutes[]`
  - `routes(r: HttpRoutes): HttpRoutes` in `src/core/define.ts`
  - `buildServer(opts?: { routes: HttpRoutes[]; deps: HttpDeps }): FastifyInstance`
  - `acceptRawJson(app: FastifyInstance, bodyLimit?: number): void` and `WEBHOOK_BODY_LIMIT` in `src/core/http.ts`
  - `Env.githubWebhookSecret?: string`, `Env.jiraWebhookSecret?: string`

- [ ] **Step 1: Add the fixture and update helpers**

Create `tests/fixtures/modules/beta/routes/hello.ts`:

```ts
import { routes } from '../../../../../src/core/define.js';

export default routes(async (app) => {
  app.get('/hello', async () => ({ hi: true }));
});
```

In `tests/helpers.ts`, change the `fakeModule` return to:

```ts
  return { meta: { name, description: `${name} module`, ...meta }, commands, events, jobs: [], config: null, routes: [] };
```

- [ ] **Step 2: Write the failing tests**

In `tests/core/loader.test.ts`, inside `loads every module folder that has an index`, append:

```ts
    expect(beta.routes).toHaveLength(1);
    expect(modules[0]!.routes).toEqual([]);
```

Replace `tests/core/http.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { acceptRawJson, buildServer } from '../../src/core/http.js';
import type { HttpRoutes } from '../../src/core/types.js';
import { silentLog, testEnv } from '../helpers.js';

const deps = { env: testEnv({ port: 4321 }), log: silentLog() };

describe('buildServer', () => {
  it('answers the healthcheck', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('mounts module routes and hands them deps', async () => {
    const hello: HttpRoutes = async (app, { env }) => {
      app.get('/hello', async () => ({ port: env.port }));
    };
    const app = buildServer({ routes: [hello], deps });
    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.json()).toEqual({ port: 4321 });
    await app.close();
  });
});

describe('acceptRawJson', () => {
  const raw: HttpRoutes = async (app) => {
    acceptRawJson(app);
    app.post('/raw', async (req) => ({ isBuffer: Buffer.isBuffer(req.body), length: (req.body as Buffer).length }));
  };
  const parsed: HttpRoutes = async (app) => {
    app.post('/parsed', async (req) => ({ type: typeof req.body }));
  };

  it('keeps JSON as raw bytes in its own scope only', async () => {
    const app = buildServer({ routes: [raw, parsed], deps });
    const body = '{"a":1}';
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    expect((await app.inject({ method: 'POST', url: '/raw', payload: body, headers })).json()).toEqual({
      isBuffer: true,
      length: body.length,
    });
    expect((await app.inject({ method: 'POST', url: '/parsed', payload: body, headers })).json()).toEqual({
      type: 'object',
    });
    await app.close();
  });

  it('accepts bodies over 1 MB', async () => {
    const app = buildServer({ routes: [raw], deps });
    const body = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
    const res = await app.inject({
      method: 'POST',
      url: '/raw',
      payload: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(body.length);
    await app.close();
  });
});
```

In `tests/env.test.ts`, add to the `applies defaults` expectation object:

```ts
      githubWebhookSecret: undefined,
      jiraWebhookSecret: undefined,
```

and add a test:

```ts
  it('reads webhook secrets and treats empty ones as unset', () => {
    const env = parseEnv({ ...base, GITHUB_WEBHOOK_SECRET: 'gh', JIRA_WEBHOOK_SECRET: '' });
    expect(env.githubWebhookSecret).toBe('gh');
    expect(env.jiraWebhookSecret).toBeUndefined();
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/core/http.test.ts tests/core/loader.test.ts tests/env.test.ts`
Expected: FAIL (`acceptRawJson` and `routes` not exported, secrets not parsed).

- [ ] **Step 4: Add the types and helper**

In `src/core/types.ts`, add:

```ts
import type { FastifyInstance } from 'fastify';
import type { Logger } from './log.js';
```

and, after `ConfigSection`:

```ts
export interface HttpDeps {
  env: Env;
  log: Logger;
}

/** A module's HTTP routes. Lives in `src/modules/<name>/routes/`, one Fastify scope per file. */
export type HttpRoutes = (app: FastifyInstance, deps: HttpDeps) => Promise<void>;
```

Add `routes: HttpRoutes[];` to `LoadedModule` (after `config`).

In `src/core/define.ts`, add `HttpRoutes` to the type import and:

```ts
export const routes = (r: HttpRoutes): HttpRoutes => r;
```

- [ ] **Step 5: Load routes in `src/core/loader.ts`**

Add `HttpRoutes` to the type import. In the `modules.push({ ... })` object, add after `config`:

```ts
      routes: await importAll<HttpRoutes>(join(dir, 'routes')),
```

Update the `loadModules` doc comment to: `/** Loads every \`root/<module>/index\` plus its commands/, events/, jobs/, routes/ folders and optional config. */`

- [ ] **Step 6: Replace `src/core/http.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { HttpDeps, HttpRoutes } from './types.js';

export interface ServerOptions {
  routes: HttpRoutes[];
  deps: HttpDeps;
}

export function buildServer(opts?: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ ok: true }));
  if (opts) {
    // One encapsulated scope per routes file, so parser changes stay local to it.
    for (const plugin of opts.routes) app.register(async (scope) => plugin(scope, opts.deps));
  }
  return app;
}

// GitHub caps webhook payloads at 25 MB. Fastify's default limit is 1 MB.
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

/** In this scope, JSON bodies arrive as raw Buffers so webhook signatures can be checked. */
export function acceptRawJson(app: FastifyInstance, bodyLimit = WEBHOOK_BODY_LIMIT): void {
  app.removeContentTypeParser(['application/json']);
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => {
    done(null, body);
  });
}
```

- [ ] **Step 7: Add the secrets to `src/env.ts`**

Add to `schema`:

```ts
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
```

Add to `Env`:

```ts
  githubWebhookSecret?: string;
  jiraWebhookSecret?: string;
```

Add to the object returned by `parseEnv`:

```ts
    githubWebhookSecret: e.GITHUB_WEBHOOK_SECRET || undefined,
    jiraWebhookSecret: e.JIRA_WEBHOOK_SECRET || undefined,
```

- [ ] **Step 8: Wire routes in `src/index.ts` and document the env vars**

Replace `const server = buildServer();` with:

```ts
const server = buildServer({ routes: registry.modules.flatMap((m) => m.routes), deps: { env, log } });
```

Append to `.env.example`:

```
GITHUB_WEBHOOK_SECRET=
JIRA_WEBHOOK_SECRET=
```

- [ ] **Step 9: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src tests .env.example
git commit -m "let modules mount http routes and read webhook secrets"
```

---

### Task 4: Dev module, feed storage, and `/config dev`

**Files:**
- Modify: `prisma/schema.prisma` (+ new migration)
- Modify: `tests/db.ts`
- Create: `src/modules/dev/index.ts`, `src/modules/dev/config.ts`
- Create: `src/modules/dev/lib/types.ts`, `src/modules/dev/lib/feeds.ts`
- Test: `tests/modules/dev/feeds.test.ts`

**Interfaces:**
- Consumes: `configSection()`, `UserError`, `prisma`.
- Produces (`src/modules/dev/lib/types.ts`):
  - `type FeedSource = 'github' | 'jira'`
  - `type DevEventKind = 'pr.opened' | 'pr.merged' | 'workflow.failed' | 'release.published' | 'push' | 'issue.created' | 'issue.transitioned' | 'issue.done' | 'issue.assigned'`
  - `NOTIFY_KINDS: ReadonlySet<DevEventKind>` (every kind except `push`)
  - `interface NormalizedEvent { source: FeedSource; kind: DevEventKind; key: string; actor: string | null; actorName: string | null; title: string; url: string | null; detail: string | null; count: number | null }`
- Produces (`src/modules/dev/lib/feeds.ts`):
  - `SOURCE_LABEL: Record<FeedSource, string>`, `MAX_FEEDS_PER_GUILD = 25`
  - `normalizeTarget(source: FeedSource, raw: string): string` (throws `UserError`)
  - `addFeed(guildId, source, target, channelId): Promise<{ key: string; moved: boolean }>`
  - `removeFeed(guildId, source, target): Promise<string>` (returns key, throws `UserError` if none)
  - `listFeeds(guildId): Promise<DevFeed[]>`
  - `feedTargets(source, key): Promise<{ guildId: string; channelId: string }[]>`
  - `removeFeedsForChannel(channelId): Promise<number>`
  - `describeFeeds(feeds: DevFeed[]): string`
  - `canPost(perms: Readonly<PermissionsBitField> | null): boolean`
- Prisma models `DevFeed`, `DevEvent` (fields below).

- [ ] **Step 1: Add the models to `prisma/schema.prisma`**

Append:

```prisma
// Where a guild wants a repo's or project's events posted.
model DevFeed {
  id        Int      @id @default(autoincrement())
  guildId   String
  // github | jira
  source    String
  // GitHub "owner/repo" (lowercased) or Jira project key (uppercased).
  key       String
  channelId String
  createdAt DateTime @default(now())

  @@unique([guildId, source, key])
  @@index([source, key])
}

// Every normalized webhook event, notified or not. Senior Design reads these later.
model DevEvent {
  id         Int      @id @default(autoincrement())
  // "<source>:<delivery id>#<index>", unique so redeliveries are ignored.
  deliveryId String   @unique
  source     String
  kind       String
  key        String
  // GitHub login or Jira accountId of whoever triggered it.
  actor      String?
  actorName  String?
  title      String
  url        String?
  detail     String?
  // Commit count for pushes.
  count      Int?
  createdAt  DateTime @default(now())

  @@index([source, key, createdAt])
  @@index([actor, createdAt])
}
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name dev_feeds`
Expected: creates `prisma/migrations/<timestamp>_dev_feeds/migration.sql` and regenerates the client.

- [ ] **Step 3: Clear the new tables in `tests/db.ts`**

```ts
import { prisma } from '../src/db.js';
import { clearGuildConfigCache } from '../src/core/guildConfig.js';

export async function resetDb(): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.devEvent.deleteMany();
  await prisma.devFeed.deleteMany();
  await prisma.guildConfig.deleteMany();
  clearGuildConfigCache();
}
```

- [ ] **Step 4: Write `src/modules/dev/lib/types.ts`**

```ts
export type FeedSource = 'github' | 'jira';

export type DevEventKind =
  | 'pr.opened'
  | 'pr.merged'
  | 'workflow.failed'
  | 'release.published'
  | 'push'
  | 'issue.created'
  | 'issue.transitioned'
  | 'issue.done'
  | 'issue.assigned';

// Pushes are stored for Senior Design stats but never posted.
export const NOTIFY_KINDS: ReadonlySet<DevEventKind> = new Set<DevEventKind>([
  'pr.opened',
  'pr.merged',
  'workflow.failed',
  'release.published',
  'issue.created',
  'issue.transitioned',
  'issue.done',
  'issue.assigned',
]);

/** One webhook payload becomes zero or more of these. */
export interface NormalizedEvent {
  source: FeedSource;
  kind: DevEventKind;
  /** GitHub "owner/repo" lowercased, or Jira project key uppercased. */
  key: string;
  actor: string | null;
  actorName: string | null;
  title: string;
  url: string | null;
  detail: string | null;
  count: number | null;
}
```

- [ ] **Step 5: Write the failing test `tests/modules/dev/feeds.test.ts`**

```ts
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db.js';
import { UserError } from '../../../src/core/errors.js';
import {
  MAX_FEEDS_PER_GUILD,
  addFeed,
  canPost,
  describeFeeds,
  feedTargets,
  listFeeds,
  normalizeTarget,
  removeFeed,
  removeFeedsForChannel,
} from '../../../src/modules/dev/lib/feeds.js';
import { resetDb } from '../../db.js';

describe('normalizeTarget', () => {
  it('lowercases GitHub repos and accepts pasted URLs', () => {
    expect(normalizeTarget('github', 'oliveirag/guiBot')).toBe('oliveirag/guibot');
    expect(normalizeTarget('github', ' https://github.com/oliveirag/guiBot.git/ ')).toBe('oliveirag/guibot');
  });

  it('uppercases Jira project keys', () => {
    expect(normalizeTarget('jira', 'sd')).toBe('SD');
  });

  it('rejects things that are not a repo or project key', () => {
    expect(() => normalizeTarget('github', 'guiBot')).toThrow(UserError);
    expect(() => normalizeTarget('jira', 'SD-12')).toThrow(UserError);
    expect(() => normalizeTarget('jira', '1SD')).toThrow(UserError);
  });
});

describe('feeds', () => {
  beforeEach(resetDb);

  it('adds a feed and moves it when added again with another channel', async () => {
    expect(await addFeed('g1', 'github', 'Owner/Repo', 'c1')).toEqual({ key: 'owner/repo', moved: false });
    expect(await addFeed('g1', 'github', 'owner/repo', 'c2')).toEqual({ key: 'owner/repo', moved: true });
    const feeds = await listFeeds('g1');
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.channelId).toBe('c2');
  });

  it('caps feeds per guild', async () => {
    for (let i = 0; i < MAX_FEEDS_PER_GUILD; i++) await addFeed('g1', 'jira', `P${i}`, 'c1');
    await expect(addFeed('g1', 'jira', 'NEW', 'c1')).rejects.toThrow(/already has 25 feeds/);
    // Re-pointing an existing feed still works at the cap.
    await expect(addFeed('g1', 'jira', 'P0', 'c2')).resolves.toEqual({ key: 'P0', moved: true });
  });

  it('removes a feed and complains about missing ones', async () => {
    await addFeed('g1', 'jira', 'SD', 'c1');
    expect(await removeFeed('g1', 'jira', 'sd')).toBe('SD');
    await expect(removeFeed('g1', 'jira', 'SD')).rejects.toThrow(/No Jira feed for SD/);
  });

  it('finds every guild subscribed to a key', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g2', 'github', 'o/r', 'c2');
    await addFeed('g2', 'jira', 'SD', 'c3');
    const targets = await feedTargets('github', 'o/r');
    expect(targets.sort((a, b) => a.guildId.localeCompare(b.guildId))).toEqual([
      { guildId: 'g1', channelId: 'c1' },
      { guildId: 'g2', channelId: 'c2' },
    ]);
  });

  it('removes every feed pointing at a channel', async () => {
    await addFeed('g1', 'github', 'o/r', 'gone');
    await addFeed('g1', 'jira', 'SD', 'gone');
    await addFeed('g1', 'jira', 'OK', 'kept');
    expect(await removeFeedsForChannel('gone')).toBe(2);
    expect(await prisma.devFeed.count()).toBe(1);
  });

  it('describes feeds for /config dev list', async () => {
    expect(describeFeeds([])).toMatch(/No feeds yet/);
    await addFeed('g1', 'github', 'o/r', 'c1');
    expect(describeFeeds(await listFeeds('g1'))).toBe('GitHub **o/r** → <#c1>');
  });
});

describe('canPost', () => {
  it('needs view, send, and embed links', () => {
    const all = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]);
    expect(canPost(all)).toBe(true);
    expect(canPost(new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))).toBe(false);
    expect(canPost(null)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/modules/dev/feeds.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Write `src/modules/dev/lib/feeds.ts`**

```ts
import type { DevFeed } from '@prisma/client';
import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import { UserError } from '../../../core/errors.js';
import { prisma } from '../../../db.js';
import type { FeedSource } from './types.js';

export const SOURCE_LABEL: Record<FeedSource, string> = { github: 'GitHub', jira: 'Jira' };
export const MAX_FEEDS_PER_GUILD = 25;

const GITHUB_REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const JIRA_PROJECT = /^[A-Z][A-Z0-9_]+$/;

export function normalizeTarget(source: FeedSource, raw: string): string {
  const value = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (source === 'github') {
    const key = value.toLowerCase();
    if (!GITHUB_REPO.test(key)) throw new UserError('Use the repo as owner/name, like oliveirag/guiBot.');
    return key;
  }
  const key = value.toUpperCase();
  if (!JIRA_PROJECT.test(key)) throw new UserError('Use the Jira project key, like SD.');
  return key;
}

export async function addFeed(
  guildId: string,
  source: FeedSource,
  target: string,
  channelId: string,
): Promise<{ key: string; moved: boolean }> {
  const key = normalizeTarget(source, target);
  const where = { guildId_source_key: { guildId, source, key } };
  const existing = await prisma.devFeed.findUnique({ where });
  if (!existing && (await prisma.devFeed.count({ where: { guildId } })) >= MAX_FEEDS_PER_GUILD) {
    throw new UserError(`This server already has ${MAX_FEEDS_PER_GUILD} feeds. Remove one first.`);
  }
  await prisma.devFeed.upsert({ where, create: { guildId, source, key, channelId }, update: { channelId } });
  return { key, moved: existing !== null && existing.channelId !== channelId };
}

export async function removeFeed(guildId: string, source: FeedSource, target: string): Promise<string> {
  const key = normalizeTarget(source, target);
  const { count } = await prisma.devFeed.deleteMany({ where: { guildId, source, key } });
  if (count === 0) throw new UserError(`No ${SOURCE_LABEL[source]} feed for ${key}.`);
  return key;
}

export function listFeeds(guildId: string): Promise<DevFeed[]> {
  return prisma.devFeed.findMany({ where: { guildId }, orderBy: [{ source: 'asc' }, { key: 'asc' }] });
}

export function feedTargets(source: FeedSource, key: string): Promise<{ guildId: string; channelId: string }[]> {
  return prisma.devFeed.findMany({ where: { source, key }, select: { guildId: true, channelId: true } });
}

export async function removeFeedsForChannel(channelId: string): Promise<number> {
  return (await prisma.devFeed.deleteMany({ where: { channelId } })).count;
}

export function describeFeeds(feeds: DevFeed[]): string {
  if (feeds.length === 0) return 'No feeds yet. Add one with `/config dev add`.';
  return feeds.map((f) => `${SOURCE_LABEL[f.source as FeedSource]} **${f.key}** → <#${f.channelId}>`).join('\n');
}

export function canPost(perms: Readonly<PermissionsBitField> | null): boolean {
  return (
    perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) ??
    false
  );
}
```

- [ ] **Step 8: Write `src/modules/dev/index.ts`**

```ts
import { moduleMeta } from '../../core/define.js';

export default moduleMeta({ name: 'dev', description: 'GitHub and Jira notifications.' });
```

- [ ] **Step 9: Write `src/modules/dev/config.ts`**

```ts
import { ChannelType, MessageFlags } from 'discord.js';
import { configSection } from '../../core/define.js';
import { info, ok } from '../../core/embeds.js';
import { UserError } from '../../core/errors.js';
import { prisma } from '../../db.js';
import { SOURCE_LABEL, addFeed, canPost, describeFeeds, listFeeds, removeFeed } from './lib/feeds.js';
import type { FeedSource } from './lib/types.js';

const SOURCES = [
  { name: 'GitHub', value: 'github' },
  { name: 'Jira', value: 'jira' },
];

export default configSection({
  build: (g) =>
    g
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Post a GitHub repo or Jira project to a channel.')
          .addStringOption((o) =>
            o.setName('source').setDescription('Where events come from').setRequired(true).addChoices(...SOURCES),
          )
          .addStringOption((o) =>
            o.setName('target').setDescription('GitHub owner/repo or Jira project key').setRequired(true),
          )
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to post in')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Stop posting a repo or project.')
          .addStringOption((o) =>
            o.setName('source').setDescription('Where events come from').setRequired(true).addChoices(...SOURCES),
          )
          .addStringOption((o) =>
            o.setName('target').setDescription('GitHub owner/repo or Jira project key').setRequired(true),
          ),
      )
      .addSubcommand((s) => s.setName('list').setDescription('Show where each repo and project posts.')),

  async run({ interaction }) {
    if (!interaction.inCachedGuild()) throw new UserError('Run this in a server.');
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const embed = info(describeFeeds(await listFeeds(guildId)), 'Dev feeds').setFooter({
        text: 'Webhooks go to POST /webhooks/github and /webhooks/jira',
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const source = interaction.options.getString('source', true) as FeedSource;
    const target = interaction.options.getString('target', true);

    if (sub === 'remove') {
      const key = await removeFeed(guildId, source, target);
      await interaction.reply({
        embeds: [ok(`${SOURCE_LABEL[source]} **${key}** won't post here anymore.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    if (!canPost(channel.permissionsFor(interaction.client.user))) {
      throw new UserError(`I can't post in ${channel}. I need View Channel, Send Messages, and Embed Links there.`);
    }
    const { key, moved } = await addFeed(guildId, source, target, channel.id);
    await interaction.reply({
      embeds: [ok(`${SOURCE_LABEL[source]} **${key}** now posts in ${channel}.${moved ? ' Moved from its old channel.' : ''}`)],
      flags: MessageFlags.Ephemeral,
    });
  },

  async view(guildId) {
    const count = await prisma.devFeed.count({ where: { guildId } });
    return count === 0 ? 'no feeds yet' : `${count} feed${count === 1 ? '' : 's'}`;
  },
});
```

- [ ] **Step 10: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add prisma src/modules/dev tests/db.ts tests/modules/dev/feeds.test.ts
git commit -m "add dev module with feed storage and /config dev"
```

---

### Task 5: Signature check and GitHub normalizer

**Files:**
- Create: `src/modules/dev/lib/signature.ts`, `src/modules/dev/lib/github.ts`
- Test: `tests/modules/dev/signature.test.ts`, `tests/modules/dev/github.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `DevEventKind` from Task 4.
- Produces:
  - `verifySignature(secret: string, body: Buffer, header: string | undefined): boolean` (expects `sha256=<hex>`)
  - `signBody(secret: string, body: Buffer | string): string` (returns `sha256=<hex>`, used by tests and handy for curl)
  - `normalizeGithub(event: string, payload: unknown): NormalizedEvent[]`

Rules for `normalizeGithub` (key is always `repository.full_name` lowercased):
- `pull_request` + `opened` (not draft) or `ready_for_review` → `pr.opened`, actor = PR author, detail `"<author> wants to merge into <base>"`.
- `pull_request` + `closed` + merged → `pr.merged`, actor = PR author (credit goes to the author), detail `"Merged into <base> by <merged_by>"`.
- `workflow_run` + `completed` + conclusion in `failure | timed_out | startup_failure` → `workflow.failed`, title `"<name> #<run_number> failed"`, detail `"On <branch>"`.
- `release` + `published` → `release.published`, title = release name or tag, detail `"Tagged <tag>"` or `"Pre-release <tag>"`.
- `push` to a branch with at least one distinct commit and not a deletion → `push`, `count` = distinct commits, actor = sender.
- Anything else, or a payload that doesn't match its schema → `[]`.

- [ ] **Step 1: Write the failing tests**

`tests/modules/dev/signature.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../../../src/modules/dev/lib/signature.js';

// Example from GitHub's "Validating webhook deliveries" docs.
const secret = "It's a Secret to Everybody";
const body = Buffer.from('Hello, World!');
const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

describe('verifySignature', () => {
  it('accepts the documented example', () => {
    expect(verifySignature(secret, body, header)).toBe(true);
    expect(signBody(secret, body)).toBe(header);
  });

  it('rejects a wrong secret, a tampered body, and malformed headers without throwing', () => {
    expect(verifySignature('nope', body, header)).toBe(false);
    expect(verifySignature(secret, Buffer.from('Hello, World?'), header)).toBe(false);
    expect(verifySignature(secret, body, undefined)).toBe(false);
    expect(verifySignature(secret, body, 'sha1=abc')).toBe(false);
    expect(verifySignature(secret, body, 'sha256=zz')).toBe(false);
    expect(verifySignature(secret, body, 'sha256=')).toBe(false);
  });
});
```

`tests/modules/dev/github.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeGithub } from '../../../src/modules/dev/lib/github.js';

const repository = { full_name: 'OliveiraG/guiBot' };
const pr = (extra: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add login',
  html_url: 'https://github.com/OliveiraG/guiBot/pull/12',
  user: { login: 'gui' },
  merged: false,
  merged_by: null,
  base: { ref: 'main' },
  draft: false,
  ...extra,
});

describe('normalizeGithub', () => {
  it('turns an opened PR into pr.opened', () => {
    expect(normalizeGithub('pull_request', { action: 'opened', repository, pull_request: pr() })).toEqual([
      {
        source: 'github',
        kind: 'pr.opened',
        key: 'oliveirag/guibot',
        actor: 'gui',
        actorName: 'gui',
        title: '#12 Add login',
        url: 'https://github.com/OliveiraG/guiBot/pull/12',
        detail: 'gui wants to merge into main',
        count: null,
      },
    ]);
  });

  it('skips draft PRs until they are ready for review', () => {
    expect(normalizeGithub('pull_request', { action: 'opened', repository, pull_request: pr({ draft: true }) })).toEqual([]);
    const ready = normalizeGithub('pull_request', { action: 'ready_for_review', repository, pull_request: pr() });
    expect(ready.map((e) => e.kind)).toEqual(['pr.opened']);
  });

  it('turns a merged PR into pr.merged and ignores closed-unmerged', () => {
    const merged = normalizeGithub('pull_request', {
      action: 'closed',
      repository,
      pull_request: pr({ merged: true, merged_by: { login: 'ana' } }),
    });
    expect(merged).toMatchObject([{ kind: 'pr.merged', actor: 'gui', detail: 'Merged into main by ana' }]);
    expect(normalizeGithub('pull_request', { action: 'closed', repository, pull_request: pr() })).toEqual([]);
  });

  it('reports failed workflow runs only', () => {
    const run = (conclusion: string) => ({
      action: 'completed',
      repository,
      workflow_run: {
        name: 'CI',
        head_branch: 'main',
        conclusion,
        html_url: 'https://github.com/x/actions/runs/1',
        run_number: 41,
        actor: { login: 'gui' },
      },
    });
    expect(normalizeGithub('workflow_run', run('failure'))).toMatchObject([
      { kind: 'workflow.failed', title: 'CI #41 failed', detail: 'On main', actor: 'gui' },
    ]);
    expect(normalizeGithub('workflow_run', run('success'))).toEqual([]);
    expect(normalizeGithub('workflow_run', run('cancelled'))).toEqual([]);
  });

  it('turns a published release into release.published', () => {
    const release = (prerelease: boolean, name: string | null) => ({
      action: 'published',
      repository,
      release: { tag_name: 'v1.0.0', name, html_url: 'https://github.com/x/releases/v1.0.0', prerelease, author: { login: 'gui' } },
    });
    expect(normalizeGithub('release', release(false, 'Launch'))).toMatchObject([
      { kind: 'release.published', title: 'Launch', detail: 'Tagged v1.0.0' },
    ]);
    expect(normalizeGithub('release', release(true, null))).toMatchObject([{ title: 'v1.0.0', detail: 'Pre-release v1.0.0' }]);
  });

  it('stores branch pushes with their distinct commit count', () => {
    const push = (extra: Record<string, unknown>) => ({
      ref: 'refs/heads/main',
      repository,
      sender: { login: 'gui' },
      compare: 'https://github.com/x/compare/a...b',
      commits: [{ distinct: true }, { distinct: true }, { distinct: false }],
      ...extra,
    });
    expect(normalizeGithub('push', push({}))).toMatchObject([
      { kind: 'push', count: 2, actor: 'gui', title: '2 commits to main', url: 'https://github.com/x/compare/a...b' },
    ]);
    expect(normalizeGithub('push', push({ deleted: true }))).toEqual([]);
    expect(normalizeGithub('push', push({ ref: 'refs/tags/v1' }))).toEqual([]);
    expect(normalizeGithub('push', push({ commits: [] }))).toEqual([]);
  });

  it('ignores unknown events and malformed payloads', () => {
    expect(normalizeGithub('star', { action: 'created', repository })).toEqual([]);
    expect(normalizeGithub('pull_request', { action: 'opened' })).toEqual([]);
    expect(normalizeGithub('push', null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/modules/dev/signature.test.ts tests/modules/dev/github.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/modules/dev/lib/signature.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/** Checks a `sha256=<hex>` HMAC header (GitHub X-Hub-Signature-256, Jira X-Hub-Signature). */
export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  const given = Buffer.from(header.slice(PREFIX.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signBody(secret: string, body: Buffer | string): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}
```

- [ ] **Step 4: Write `src/modules/dev/lib/github.ts`**

```ts
import { z } from 'zod';
import type { DevEventKind, NormalizedEvent } from './types.js';

const user = z.object({ login: z.string() });
const repository = z.object({ full_name: z.string() });

const pullRequestEvent = z.object({
  action: z.string(),
  repository,
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    user,
    merged: z.boolean().nullish(),
    merged_by: user.nullish(),
    base: z.object({ ref: z.string() }),
    draft: z.boolean().optional(),
  }),
});

const workflowRunEvent = z.object({
  action: z.string(),
  repository,
  workflow_run: z.object({
    name: z.string().nullish(),
    head_branch: z.string().nullish(),
    conclusion: z.string().nullish(),
    html_url: z.string(),
    run_number: z.number(),
    actor: user.nullish(),
  }),
});

const releaseEvent = z.object({
  action: z.string(),
  repository,
  release: z.object({
    tag_name: z.string(),
    name: z.string().nullish(),
    html_url: z.string(),
    prerelease: z.boolean(),
    author: user.nullish(),
  }),
});

const pushEvent = z.object({
  ref: z.string(),
  deleted: z.boolean().optional(),
  compare: z.string().nullish(),
  repository,
  sender: user,
  commits: z.array(z.object({ distinct: z.boolean().optional() })).default([]),
});

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

function event(
  kind: DevEventKind,
  fullName: string,
  actor: string | null,
  fields: Pick<NormalizedEvent, 'title' | 'url' | 'detail'> & { count?: number },
): NormalizedEvent {
  return {
    source: 'github',
    kind,
    key: fullName.toLowerCase(),
    actor,
    actorName: actor,
    title: fields.title,
    url: fields.url,
    detail: fields.detail,
    count: fields.count ?? null,
  };
}

export function normalizeGithub(name: string, payload: unknown): NormalizedEvent[] {
  switch (name) {
    case 'pull_request': {
      const parsed = pullRequestEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { action, repository: repo, pull_request: pr } = parsed.data;
      const base = { title: `#${pr.number} ${pr.title}`, url: pr.html_url };
      if ((action === 'opened' && !pr.draft) || action === 'ready_for_review') {
        return [event('pr.opened', repo.full_name, pr.user.login, { ...base, detail: `${pr.user.login} wants to merge into ${pr.base.ref}` })];
      }
      if (action === 'closed' && pr.merged) {
        const by = pr.merged_by ? ` by ${pr.merged_by.login}` : '';
        return [event('pr.merged', repo.full_name, pr.user.login, { ...base, detail: `Merged into ${pr.base.ref}${by}` })];
      }
      return [];
    }
    case 'workflow_run': {
      const parsed = workflowRunEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { action, repository: repo, workflow_run: run } = parsed.data;
      if (action !== 'completed' || !FAILED.has(run.conclusion ?? '')) return [];
      return [
        event('workflow.failed', repo.full_name, run.actor?.login ?? null, {
          title: `${run.name ?? 'Workflow'} #${run.run_number} failed`,
          url: run.html_url,
          detail: run.head_branch ? `On ${run.head_branch}` : null,
        }),
      ];
    }
    case 'release': {
      const parsed = releaseEvent.safeParse(payload);
      if (!parsed.success || parsed.data.action !== 'published') return [];
      const { repository: repo, release } = parsed.data;
      return [
        event('release.published', repo.full_name, release.author?.login ?? null, {
          title: release.name?.trim() || release.tag_name,
          url: release.html_url,
          detail: `${release.prerelease ? 'Pre-release' : 'Tagged'} ${release.tag_name}`,
        }),
      ];
    }
    case 'push': {
      const parsed = pushEvent.safeParse(payload);
      if (!parsed.success) return [];
      const { ref, deleted, compare, repository: repo, sender, commits } = parsed.data;
      if (deleted || !ref.startsWith('refs/heads/')) return [];
      const count = commits.filter((c) => c.distinct !== false).length;
      if (count === 0) return [];
      const branch = ref.slice('refs/heads/'.length);
      return [
        event('push', repo.full_name, sender.login, {
          title: `${count} commit${count === 1 ? '' : 's'} to ${branch}`,
          url: compare ?? null,
          detail: null,
          count,
        }),
      ];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/modules/dev && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dev/lib/signature.ts src/modules/dev/lib/github.ts tests/modules/dev/signature.test.ts tests/modules/dev/github.test.ts
git commit -m "verify webhook signatures and normalize github events"
```

---

### Task 6: Jira normalizer

**Files:**
- Create: `src/modules/dev/lib/jira.ts`
- Test: `tests/modules/dev/jira.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent` from Task 4.
- Produces: `normalizeJira(payload: unknown): NormalizedEvent[]`

Rules (key is `issue.fields.project.key` uppercased, title `"<ISSUE-KEY> <summary>"`, url `<origin of issue.self>/browse/<ISSUE-KEY>`, actor = `user.accountId`, actorName = `user.displayName`):
- `jira:issue_created` → `issue.created`, detail `"<Issue type> created by <displayName>"`.
- `jira:issue_updated` → one event per relevant changelog item, in order:
  - `status` → `issue.done` when the issue's current status category is `done`, else `issue.transitioned`; detail `"<from> → <to>"`.
  - `assignee` → `issue.assigned`; detail `"Assigned to <to>"` or `"Unassigned"`.
- Anything else, or a malformed payload → `[]`.

- [ ] **Step 1: Write the failing test `tests/modules/dev/jira.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeJira } from '../../../src/modules/dev/lib/jira.js';

const issue = (statusCategory = 'indeterminate') => ({
  key: 'SD-12',
  self: 'https://team.atlassian.net/rest/api/3/issue/10012',
  fields: {
    summary: 'Build login page',
    project: { key: 'sd' },
    issuetype: { name: 'Story' },
    status: { name: 'In Progress', statusCategory: { key: statusCategory } },
  },
});
const user = { accountId: 'acc-1', displayName: 'Gui' };

describe('normalizeJira', () => {
  it('turns issue_created into issue.created', () => {
    expect(normalizeJira({ webhookEvent: 'jira:issue_created', user, issue: issue() })).toEqual([
      {
        source: 'jira',
        kind: 'issue.created',
        key: 'SD',
        actor: 'acc-1',
        actorName: 'Gui',
        title: 'SD-12 Build login page',
        url: 'https://team.atlassian.net/browse/SD-12',
        detail: 'Story created by Gui',
        count: null,
      },
    ]);
  });

  it('emits one event per status or assignee change', () => {
    const events = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue(),
      changelog: {
        items: [
          { field: 'status', fromString: 'To Do', toString: 'In Progress' },
          { field: 'summary', fromString: 'a', toString: 'b' },
          { field: 'assignee', fromString: null, toString: 'Ana' },
        ],
      },
    });
    expect(events.map((e) => [e.kind, e.detail])).toEqual([
      ['issue.transitioned', 'To Do → In Progress'],
      ['issue.assigned', 'Assigned to Ana'],
    ]);
  });

  it('marks moves into a done category as issue.done', () => {
    const [event] = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue('done'),
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    });
    expect(event).toMatchObject({ kind: 'issue.done', detail: 'In Progress → Done' });
  });

  it('reports unassignment', () => {
    const [event] = normalizeJira({
      webhookEvent: 'jira:issue_updated',
      user,
      issue: issue(),
      changelog: { items: [{ field: 'assignee', fromString: 'Ana', toString: null }] },
    });
    expect(event).toMatchObject({ kind: 'issue.assigned', detail: 'Unassigned' });
  });

  it('ignores updates with no relevant changes, other events, and malformed payloads', () => {
    expect(normalizeJira({ webhookEvent: 'jira:issue_updated', user, issue: issue() })).toEqual([]);
    expect(normalizeJira({ webhookEvent: 'comment_created', user, issue: issue() })).toEqual([]);
    expect(normalizeJira({ webhookEvent: 'jira:issue_created' })).toEqual([]);
    expect(normalizeJira('nope')).toEqual([]);
  });

  it('leaves url null when issue.self is not a URL', () => {
    const bad = { ...issue(), self: 'not a url' };
    expect(normalizeJira({ webhookEvent: 'jira:issue_created', user, issue: bad })[0]!.url).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/dev/jira.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/modules/dev/lib/jira.ts`**

```ts
import { z } from 'zod';
import type { NormalizedEvent } from './types.js';

const person = z.object({ accountId: z.string(), displayName: z.string() });

const issueEvent = z.object({
  webhookEvent: z.string(),
  user: person.nullish(),
  issue: z.object({
    key: z.string(),
    self: z.string(),
    fields: z.object({
      summary: z.string(),
      project: z.object({ key: z.string() }),
      issuetype: z.object({ name: z.string() }).nullish(),
      status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).nullish() }).nullish(),
    }),
  }),
  changelog: z
    .object({
      items: z.array(z.object({ field: z.string(), fromString: z.string().nullish(), toString: z.string().nullish() })),
    })
    .nullish(),
});

function browseUrl(self: string, issueKey: string): string | null {
  try {
    return `${new URL(self).origin}/browse/${issueKey}`;
  } catch {
    return null;
  }
}

export function normalizeJira(payload: unknown): NormalizedEvent[] {
  const parsed = issueEvent.safeParse(payload);
  if (!parsed.success) return [];
  const { webhookEvent, user, issue, changelog } = parsed.data;
  const common = {
    source: 'jira' as const,
    key: issue.fields.project.key.toUpperCase(),
    actor: user?.accountId ?? null,
    actorName: user?.displayName ?? null,
    title: `${issue.key} ${issue.fields.summary}`,
    url: browseUrl(issue.self, issue.key),
    count: null,
  };

  if (webhookEvent === 'jira:issue_created') {
    const type = issue.fields.issuetype?.name ?? 'Issue';
    return [{ ...common, kind: 'issue.created', detail: `${type} created${user ? ` by ${user.displayName}` : ''}` }];
  }
  if (webhookEvent !== 'jira:issue_updated') return [];

  const events: NormalizedEvent[] = [];
  for (const item of changelog?.items ?? []) {
    if (item.field === 'status') {
      const done = issue.fields.status?.statusCategory?.key === 'done';
      events.push({
        ...common,
        kind: done ? 'issue.done' : 'issue.transitioned',
        detail: `${item.fromString ?? '?'} → ${item.toString ?? '?'}`,
      });
    } else if (item.field === 'assignee') {
      events.push({ ...common, kind: 'issue.assigned', detail: item.toString ? `Assigned to ${item.toString}` : 'Unassigned' });
    }
  }
  return events;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/modules/dev/jira.test.ts && npm run typecheck`
Expected: all pass. If zod mishandles the `toString` key (it shadows `Object.prototype.toString`), the "emits one event per status or assignee change" test fails. In that case, parse `items` as `z.array(z.record(z.string(), z.unknown()))` and read `item['toString']` as `typeof ... === 'string' ? ... : null`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dev/lib/jira.ts tests/modules/dev/jira.test.ts
git commit -m "normalize jira issue events"
```

---

### Task 7: Ingest and webhook routes

**Files:**
- Create: `src/modules/dev/lib/ingest.ts`, `src/modules/dev/lib/webhook.ts`
- Create: `src/modules/dev/routes/github.ts`, `src/modules/dev/routes/jira.ts`
- Modify: `README.md`
- Test: `tests/modules/dev/webhooks.test.ts`

**Interfaces:**
- Consumes: `scheduleJob(..., db)` (Task 1), `routes()`, `acceptRawJson()`, `HttpDeps` (Task 3), `feedTargets()`, `NOTIFY_KINDS`, `NormalizedEvent` (Task 4), `verifySignature()`/`signBody()`, `normalizeGithub()` (Task 5), `normalizeJira()` (Task 6), `isModuleEnabled()` (slice 1).
- Produces:
  - `NOTIFY_JOB = 'dev.notify'`, `interface NotifyPayload { eventId: number; channelId: string }`
  - `ingest(deliveryId: string, events: NormalizedEvent[], now?: Date): Promise<{ duplicate: boolean; stored: number; queued: number }>`
  - `webhookHandler(spec: WebhookSpec, log: Logger)` Fastify handler
  - `POST /webhooks/github`, `POST /webhooks/jira`
  - Status codes: 202 stored (or nothing relevant), 200 duplicate or ping, 400 missing delivery header or invalid JSON, 401 bad signature, 415 not JSON, 500 storage failure, 503 secret unset.

- [ ] **Step 1: Write the failing test `tests/modules/dev/webhooks.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setModuleEnabled } from '../../../src/core/guildConfig.js';
import { buildServer } from '../../../src/core/http.js';
import { prisma } from '../../../src/db.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import { signBody } from '../../../src/modules/dev/lib/signature.js';
import githubRoutes from '../../../src/modules/dev/routes/github.js';
import jiraRoutes from '../../../src/modules/dev/routes/jira.js';
import { resetDb } from '../../db.js';
import { silentLog, testEnv } from '../../helpers.js';

const GH = 'gh-secret';
const JIRA = 'jira-secret';

function makeApp(secrets: { githubWebhookSecret?: string; jiraWebhookSecret?: string } = { githubWebhookSecret: GH, jiraWebhookSecret: JIRA }) {
  return buildServer({ routes: [githubRoutes, jiraRoutes], deps: { env: testEnv(secrets), log: silentLog() } });
}

let app = makeApp();

function github(event: string, delivery: string, payload: unknown, secret = GH) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': signBody(secret, body),
    },
  });
}

function jira(identifier: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/jira',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-atlassian-webhook-identifier': identifier,
      'x-hub-signature': signBody(JIRA, body),
    },
  });
}

const mergedPr = {
  action: 'closed',
  repository: { full_name: 'o/r' },
  pull_request: {
    number: 1,
    title: 'Ship it',
    html_url: 'https://github.com/o/r/pull/1',
    user: { login: 'gui' },
    merged: true,
    merged_by: { login: 'ana' },
    base: { ref: 'main' },
  },
};

describe('dev webhooks', () => {
  beforeEach(async () => {
    await resetDb();
    app = makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('stores an event and queues one notify job per subscribed guild with dev on', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g2', 'github', 'o/r', 'c2');
    await setModuleEnabled('g2', 'dev', false);

    const res = await github('pull_request', 'd1', mergedPr);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ duplicate: false, stored: 1, queued: 1 });
    const event = await prisma.devEvent.findFirstOrThrow();
    expect(event).toMatchObject({ deliveryId: 'github:d1#0', kind: 'pr.merged', key: 'o/r', actor: 'gui' });
    const jobs = await prisma.job.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'dev.notify', guildId: 'g1' });
    expect(JSON.parse(jobs[0]!.payload)).toEqual({ eventId: event.id, channelId: 'c1' });
  });

  it('dedupes a redelivered webhook', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    expect((await github('pull_request', 'd1', mergedPr)).statusCode).toBe(202);
    const again = await github('pull_request', 'd1', mergedPr);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true });
    expect(await prisma.devEvent.count()).toBe(1);
    expect(await prisma.job.count()).toBe(1);
  });

  it('stores pushes without queueing posts', async () => {
    await addFeed('g1', 'github', 'o/r', 'c1');
    const res = await github('push', 'd2', {
      ref: 'refs/heads/main',
      repository: { full_name: 'o/r' },
      sender: { login: 'gui' },
      commits: [{ distinct: true }],
    });
    expect(res.json()).toEqual({ duplicate: false, stored: 1, queued: 0 });
    expect(await prisma.job.count()).toBe(0);
  });

  it('answers pings and ignores events it does not track', async () => {
    expect((await github('ping', 'p1', { zen: 'hi' })).statusCode).toBe(200);
    const star = await github('star', 's1', { action: 'created' });
    expect(star.statusCode).toBe(202);
    expect(star.json()).toEqual({ duplicate: false, stored: 0, queued: 0 });
    expect(await prisma.devEvent.count()).toBe(0);
  });

  it('rejects a bad signature', async () => {
    const res = await github('pull_request', 'd1', mergedPr, 'wrong');
    expect(res.statusCode).toBe(401);
    expect(await prisma.devEvent.count()).toBe(0);
  });

  it('answers 503 when the secret is unset', async () => {
    await app.close();
    app = makeApp({ jiraWebhookSecret: JIRA });
    expect((await github('pull_request', 'd1', mergedPr)).statusCode).toBe(503);
  });

  it('rejects non-JSON bodies', async () => {
    const body = 'payload=%7B%7D';
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-github-event': 'push',
        'x-github-delivery': 'f1',
        'x-hub-signature-256': signBody(GH, body),
      },
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects invalid JSON and a missing delivery id', async () => {
    const body = '{not json';
    const bad = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'j1',
        'x-hub-signature-256': signBody(GH, body),
      },
    });
    expect(bad.statusCode).toBe(400);

    const noDelivery = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': signBody(GH, '{}') },
    });
    expect(noDelivery.statusCode).toBe(400);
  });

  it('stores each change in one Jira update as its own event', async () => {
    await addFeed('g1', 'jira', 'SD', 'c9');
    const res = await jira('w1', {
      webhookEvent: 'jira:issue_updated',
      user: { accountId: 'acc-1', displayName: 'Gui' },
      issue: {
        key: 'SD-3',
        self: 'https://team.atlassian.net/rest/api/3/issue/3',
        fields: {
          summary: 'Wire login',
          project: { key: 'SD' },
          status: { name: 'Done', statusCategory: { key: 'done' } },
        },
      },
      changelog: {
        items: [
          { field: 'status', fromString: 'In Progress', toString: 'Done' },
          { field: 'assignee', fromString: null, toString: 'Ana' },
        ],
      },
    });
    expect(res.json()).toEqual({ duplicate: false, stored: 2, queued: 2 });
    const kinds = (await prisma.devEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => [e.deliveryId, e.kind]);
    expect(kinds).toEqual([
      ['jira:w1#0', 'issue.done'],
      ['jira:w1#1', 'issue.assigned'],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/dev/webhooks.test.ts`
Expected: FAIL (route modules not found).

- [ ] **Step 3: Write `src/modules/dev/lib/ingest.ts`**

```ts
import { Prisma } from '@prisma/client';
import { isModuleEnabled } from '../../../core/guildConfig.js';
import { scheduleJob } from '../../../core/scheduler.js';
import { prisma } from '../../../db.js';
import { feedTargets } from './feeds.js';
import { NOTIFY_KINDS, type NormalizedEvent } from './types.js';

export const NOTIFY_JOB = 'dev.notify';

export interface NotifyPayload {
  eventId: number;
  channelId: string;
}

export interface IngestResult {
  duplicate: boolean;
  stored: number;
  queued: number;
}

type Target = { guildId: string; channelId: string };

/**
 * Stores one delivery's events and queues a dev.notify job per subscribed channel, all or nothing.
 * `deliveryId` is "<source>:<header id>"; each event is stored as "<deliveryId>#<index>".
 */
export async function ingest(deliveryId: string, events: NormalizedEvent[], now = new Date()): Promise<IngestResult> {
  if (events.length === 0) return { duplicate: false, stored: 0, queued: 0 };
  const ids = events.map((_, i) => `${deliveryId}#${i}`);
  if (await prisma.devEvent.findUnique({ where: { deliveryId: ids[0]! } })) {
    return { duplicate: true, stored: 0, queued: 0 };
  }

  // Resolve targets before the transaction: SQLite has one writer, and these reads run outside it.
  const targets = new Map<string, Target[]>();
  for (const e of events) {
    const mapKey = `${e.source}:${e.key}`;
    if (!NOTIFY_KINDS.has(e.kind) || targets.has(mapKey)) continue;
    const enabled: Target[] = [];
    for (const target of await feedTargets(e.source, e.key)) {
      if (await isModuleEnabled(target.guildId, 'dev')) enabled.push(target);
    }
    targets.set(mapKey, enabled);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      let queued = 0;
      for (const [i, e] of events.entries()) {
        const row = await tx.devEvent.create({
          data: {
            deliveryId: ids[i]!,
            source: e.source,
            kind: e.kind,
            key: e.key,
            actor: e.actor,
            actorName: e.actorName,
            title: e.title,
            url: e.url,
            detail: e.detail,
            count: e.count,
          },
        });
        const dest = NOTIFY_KINDS.has(e.kind) ? (targets.get(`${e.source}:${e.key}`) ?? []) : [];
        for (const target of dest) {
          const payload: NotifyPayload = { eventId: row.id, channelId: target.channelId };
          await scheduleJob(NOTIFY_JOB, now, payload, target.guildId, tx);
          queued++;
        }
      }
      return { duplicate: false, stored: events.length, queued };
    });
  } catch (error) {
    // Two copies of the same delivery raced past the check above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { duplicate: true, stored: 0, queued: 0 };
    }
    throw error;
  }
}
```

- [ ] **Step 4: Write `src/modules/dev/lib/webhook.ts`**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from '../../../core/log.js';
import { ingest } from './ingest.js';
import { verifySignature } from './signature.js';
import type { FeedSource, NormalizedEvent } from './types.js';

export interface WebhookSpec {
  source: FeedSource;
  secret: string | undefined;
  signatureHeader: string;
  deliveryHeader: string;
  /** Returns null for pings and anything else that needs a 200 and no storage. */
  normalize(payload: unknown, request: FastifyRequest): NormalizedEvent[] | null;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function webhookHandler(spec: WebhookSpec, log: Logger) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!spec.secret) return reply.code(503).send({ error: `${spec.source} webhooks are not configured` });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Send the webhook as application/json' });
    if (!verifySignature(spec.secret, request.body, header(request, spec.signatureHeader))) {
      return reply.code(401).send({ error: 'Bad signature' });
    }
    const delivery = header(request, spec.deliveryHeader);
    if (!delivery) return reply.code(400).send({ error: `Missing ${spec.deliveryHeader}` });

    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    const events = spec.normalize(payload, request);
    if (events === null) return reply.code(200).send({ ok: true });

    try {
      const result = await ingest(`${spec.source}:${delivery}`, events);
      return reply.code(result.duplicate ? 200 : 202).send(result);
    } catch (error) {
      log.error(`${spec.source} webhook ${delivery} failed`, error);
      return reply.code(500).send({ error: 'Could not store the event' });
    }
  };
}
```

- [ ] **Step 5: Write the routes**

`src/modules/dev/routes/github.ts`:

```ts
import { routes } from '../../../core/define.js';
import { acceptRawJson } from '../../../core/http.js';
import { normalizeGithub } from '../lib/github.js';
import { webhookHandler } from '../lib/webhook.js';

export default routes(async (app, { env, log }) => {
  acceptRawJson(app);
  app.post(
    '/webhooks/github',
    webhookHandler(
      {
        source: 'github',
        secret: env.githubWebhookSecret,
        signatureHeader: 'x-hub-signature-256',
        deliveryHeader: 'x-github-delivery',
        normalize: (payload, request) => {
          const event = request.headers['x-github-event'];
          if (typeof event !== 'string' || event === 'ping') return null;
          return normalizeGithub(event, payload);
        },
      },
      log,
    ),
  );
});
```

`src/modules/dev/routes/jira.ts`:

```ts
import { routes } from '../../../core/define.js';
import { acceptRawJson } from '../../../core/http.js';
import { normalizeJira } from '../lib/jira.js';
import { webhookHandler } from '../lib/webhook.js';

export default routes(async (app, { env, log }) => {
  acceptRawJson(app);
  app.post(
    '/webhooks/jira',
    webhookHandler(
      {
        source: 'jira',
        secret: env.jiraWebhookSecret,
        signatureHeader: 'x-hub-signature',
        deliveryHeader: 'x-atlassian-webhook-identifier',
        normalize: (payload) => normalizeJira(payload),
      },
      log,
    ),
  );
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

- [ ] **Step 7: Document setup in `README.md`**

Insert before the `The old PrizePicks tracker...` line:

```markdown
## GitHub and Jira notifications

The `dev` module posts PRs opened/merged, failed workflow runs, releases, and Jira issue changes.

1. Set `GITHUB_WEBHOOK_SECRET` and/or `JIRA_WEBHOOK_SECRET` to long random strings (`openssl rand -hex 32`).
2. GitHub: repo Settings → Webhooks → Add webhook. Payload URL `https://<your-railway-domain>/webhooks/github`,
   content type `application/json`, the same secret, and events: Pull requests, Workflow runs, Releases, Pushes.
3. Jira: Settings → System → WebHooks → Create. URL `https://<your-railway-domain>/webhooks/jira`, the same
   secret, events: Issue created and Issue updated.
4. In Discord: `/config dev add source:GitHub target:owner/repo channel:#dev`, and the same with `source:Jira target:SD`.

Pushes are stored but not posted. Senior Design stats use them later.
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/dev tests/modules/dev/webhooks.test.ts README.md
git commit -m "receive github and jira webhooks and queue notifications"
```

---

### Task 8: Render and post notifications (`dev.notify`)

**Files:**
- Create: `src/modules/dev/lib/render.ts`, `src/modules/dev/jobs/notify.ts`
- Test: `tests/modules/dev/notify.test.ts`

**Interfaces:**
- Consumes: `JobContext.client` (Task 1), `NOTIFY_JOB` (Task 7), `removeFeedsForChannel()` (Task 4), `BRAND_COLOR`/`ERROR_COLOR`, the `DevEvent` Prisma type.
- Produces:
  - `renderEvent(event: DevEvent): EmbedBuilder`
  - The `dev.notify` job, which:
    - resolves without doing anything if the event row is gone;
    - removes every feed for the channel when it's deleted (`10003`, a `null` fetch, or a channel that can't take messages), then resolves;
    - logs and resolves when access or permissions are missing (`50001`, `50013`);
    - throws on any other error, so the scheduler retries.

- [ ] **Step 1: Write the failing test `tests/modules/dev/notify.test.ts`**

```ts
import type { DevEvent } from '@prisma/client';
import type { Client } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_COLOR, ERROR_COLOR } from '../../../src/core/embeds.js';
import { log } from '../../../src/core/log.js';
import { prisma } from '../../../src/db.js';
import notify from '../../../src/modules/dev/jobs/notify.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import { renderEvent } from '../../../src/modules/dev/lib/render.js';
import { resetDb } from '../../db.js';

let seq = 0;

function storeEvent(extra: Partial<Pick<DevEvent, 'kind' | 'title' | 'url' | 'detail'>> = {}) {
  return prisma.devEvent.create({
    data: {
      deliveryId: `github:test-${seq++}#0`,
      source: 'github',
      kind: 'pr.merged',
      key: 'o/r',
      actor: 'gui',
      actorName: 'gui',
      title: '#1 Ship it',
      url: 'https://github.com/o/r/pull/1',
      detail: 'Merged into main by ana',
      ...extra,
    },
  });
}

const apiError = (code: number) => Object.assign(new Error(`api ${code}`), { code });

function fakeClient(channel: unknown, fetchError?: Error) {
  const fetch = vi.fn(async () => {
    if (fetchError) throw fetchError;
    return channel;
  });
  return { client: { channels: { fetch } } as unknown as Client, fetch };
}

function sendable(send = vi.fn(async () => ({}))) {
  return { channel: { isSendable: () => true, send }, send };
}

describe('renderEvent', () => {
  beforeEach(resetDb);

  it('renders the label, repo, title, link, and detail', async () => {
    const json = renderEvent(await storeEvent()).toJSON();
    expect(json).toMatchObject({
      color: BRAND_COLOR,
      author: { name: 'Pull request merged · o/r' },
      title: '#1 Ship it',
      url: 'https://github.com/o/r/pull/1',
      description: 'Merged into main by ana',
    });
    expect(json.timestamp).toBeDefined();
  });

  it('colors failed workflows red', async () => {
    expect(renderEvent(await storeEvent({ kind: 'workflow.failed' })).toJSON().color).toBe(ERROR_COLOR);
  });

  it('clips long titles', async () => {
    const title = renderEvent(await storeEvent({ title: 'x'.repeat(400) })).toJSON().title!;
    expect(title).toHaveLength(256);
    expect(title.endsWith('…')).toBe(true);
  });

  it('skips non-http urls and missing details', async () => {
    const json = renderEvent(await storeEvent({ url: 'javascript:alert(1)', detail: null })).toJSON();
    expect(json.url).toBeUndefined();
    expect(json.description).toBeUndefined();
  });
});

describe('dev.notify', () => {
  beforeEach(resetDb);

  const ctx = (client: Client) => ({ id: 1, guildId: 'g1', client });

  it('posts the rendered event to the channel', async () => {
    const event = await storeEvent();
    const { channel, send } = sendable();
    const { client, fetch } = fakeClient(channel);
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(client));
    expect(fetch).toHaveBeenCalledWith('c1');
    const embed = (send.mock.calls[0]![0] as { embeds: { toJSON(): { title?: string } }[] }).embeds[0]!.toJSON();
    expect(embed.title).toBe('#1 Ship it');
  });

  it('does nothing when the event row is gone', async () => {
    const { client, fetch } = fakeClient(sendable().channel);
    await notify.run({ eventId: 999, channelId: 'c1' }, ctx(client));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops feeds for a deleted channel', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    await addFeed('g1', 'jira', 'SD', 'c1');
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(null, apiError(10003)).client));
    expect(await prisma.devFeed.count()).toBe(0);

    await addFeed('g1', 'github', 'o/r', 'c1');
    await notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(null).client));
    expect(await prisma.devFeed.count()).toBe(0);
    warn.mockRestore();
  });

  it('gives up quietly without permission and keeps the feed', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const event = await storeEvent();
    await addFeed('g1', 'github', 'o/r', 'c1');
    const { channel } = sendable(
      vi.fn(async () => {
        throw apiError(50013);
      }),
    );
    await expect(notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(channel).client))).resolves.toBeUndefined();
    expect(await prisma.devFeed.count()).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws other errors so the scheduler retries', async () => {
    const event = await storeEvent();
    const { channel } = sendable(
      vi.fn(async () => {
        throw new Error('gateway hiccup');
      }),
    );
    await expect(notify.run({ eventId: event.id, channelId: 'c1' }, ctx(fakeClient(channel).client))).rejects.toThrow(
      'gateway hiccup',
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/dev/notify.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/modules/dev/lib/render.ts`**

```ts
import type { DevEvent } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, ERROR_COLOR } from '../../../core/embeds.js';
import type { DevEventKind } from './types.js';

const LABEL: Record<DevEventKind, string> = {
  'pr.opened': 'Pull request opened',
  'pr.merged': 'Pull request merged',
  'workflow.failed': 'Workflow failed',
  'release.published': 'Release published',
  push: 'Pushed',
  'issue.created': 'Issue created',
  'issue.transitioned': 'Issue moved',
  'issue.done': 'Issue done',
  'issue.assigned': 'Issue assigned',
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function renderEvent(event: DevEvent): EmbedBuilder {
  const kind = event.kind as DevEventKind;
  const label = LABEL[kind] ?? event.kind;
  const embed = new EmbedBuilder()
    .setColor(kind === 'workflow.failed' ? ERROR_COLOR : BRAND_COLOR)
    .setAuthor({ name: clip(`${label} · ${event.key}`, 256) })
    .setTitle(clip(event.title, 256))
    .setTimestamp(event.createdAt);
  if (event.url && /^https?:\/\//.test(event.url)) embed.setURL(event.url);
  if (event.detail) embed.setDescription(clip(event.detail, 4096));
  return embed;
}
```

- [ ] **Step 4: Write `src/modules/dev/jobs/notify.ts`**

```ts
import { RESTJSONErrorCodes } from 'discord.js';
import { z } from 'zod';
import { job } from '../../../core/define.js';
import { log } from '../../../core/log.js';
import { prisma } from '../../../db.js';
import { removeFeedsForChannel } from '../lib/feeds.js';
import { NOTIFY_JOB } from '../lib/ingest.js';
import { renderEvent } from '../lib/render.js';

const payloadSchema = z.object({ eventId: z.number().int(), channelId: z.string() });

const GONE = new Set<unknown>([RESTJSONErrorCodes.UnknownChannel]);
const FORBIDDEN = new Set<unknown>([RESTJSONErrorCodes.MissingAccess, RESTJSONErrorCodes.MissingPermissions]);

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

async function dropChannel(channelId: string): Promise<void> {
  const removed = await removeFeedsForChannel(channelId);
  log.warn(`dev.notify: channel ${channelId} is gone, removed ${removed} feed(s)`);
}

/** Missing channel or perms won't fix themselves, so those end the job instead of retrying. */
async function handled(error: unknown, channelId: string): Promise<boolean> {
  if (GONE.has(codeOf(error))) {
    await dropChannel(channelId);
    return true;
  }
  if (FORBIDDEN.has(codeOf(error))) {
    log.warn(`dev.notify: no permission to post in ${channelId}`);
    return true;
  }
  return false;
}

export default job({
  type: NOTIFY_JOB,
  async run(payload, { client }) {
    const { eventId, channelId } = payloadSchema.parse(payload);
    const event = await prisma.devEvent.findUnique({ where: { id: eventId } });
    if (!event) return;

    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (error) {
      if (await handled(error, channelId)) return;
      throw error;
    }
    if (!channel?.isSendable()) {
      await dropChannel(channelId);
      return;
    }

    try {
      await channel.send({ embeds: [renderEvent(event)] });
    } catch (error) {
      if (await handled(error, channelId)) return;
      throw error;
    }
  },
});
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dev/lib/render.ts src/modules/dev/jobs/notify.ts tests/modules/dev/notify.test.ts
git commit -m "post dev notifications as branded embeds"
```

---

## Manual verification (after all tasks)

These need a real bot and can't be unit tested:

1. `npm run deploy && npm run dev`, then `/config view` shows `dev` with "no feeds yet", and `/config dev add` accepts a repo and a channel.
2. Expose the local server (`npx localtunnel --port 3000` or Railway), add the GitHub webhook, and check GitHub's "Recent Deliveries": the ping shows 200.
3. Open and merge a test PR → two embeds in the channel. Hit "Redeliver" on the merge → no third embed.
4. `/config modules disable dev` → the next PR posts nothing and `/config dev list` says dev is off.
