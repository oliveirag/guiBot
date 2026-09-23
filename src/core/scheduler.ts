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
  jobTimeoutMs?: number;
}

const RETRY_STEP_MS = 60_000;

export class Scheduler {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private current: Promise<number> | null = null;

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
      const registeredTypes = [...this.handlers.keys()];
      if (registeredTypes.length === 0) return 0;
      const due = await prisma.job.findMany({
        where: { status: 'pending', runAt: { lte: this.now() }, type: { in: registeredTypes } },
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
      // tick() only selects jobs whose type has a registered handler, so this shouldn't happen.
      this.opts.log.error(`job ${id}: no handler for ${type}`, new Error(`No handler for job type ${type}`));
      return;
    }
    const timeoutMs = this.opts.jobTimeoutMs ?? 60_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        handler.run(JSON.parse(payload), { id, guildId }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Job timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
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
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.current) return;
      const promise = this.tick().catch((error) => {
        this.opts.log.error('scheduler tick failed', error);
        return 0;
      });
      this.current = promise;
      void promise.finally(() => {
        this.current = null;
      });
    }, this.opts.intervalMs ?? 15_000);
  }

  /** Clears the interval, then waits for any in-flight tick so shutdown doesn't race it. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => {});
  }
}
