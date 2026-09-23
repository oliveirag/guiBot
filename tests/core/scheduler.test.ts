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

  it('leaves due jobs with no registered handler pending, but still runs known-type jobs in the same tick', async () => {
    const run = vi.fn(async () => {});
    const orphanId = await scheduleJob('test.orphan', secondsFrom(-1), null);
    const knownId = await scheduleJob('test.ping', secondsFrom(-1), null);

    expect(await make([{ type: 'test.ping', run }]).tick()).toBe(1);

    const orphan = await prisma.job.findUniqueOrThrow({ where: { id: orphanId } });
    expect(orphan).toMatchObject({ status: 'pending', attempts: 0 });
    const known = await prisma.job.findUniqueOrThrow({ where: { id: knownId } });
    expect(known.status).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does no query and returns 0 when no handlers are registered', async () => {
    await scheduleJob('test.orphan', secondsFrom(-1), null);
    expect(await make([]).tick()).toBe(0);
  });

  it('times out a handler that never resolves, going through the retry path', async () => {
    const handler: JobHandler = {
      type: 'test.hang',
      run: () => new Promise(() => {}),
    };
    const scheduler = new Scheduler({ handlers: [handler], log: silentLog(), maxAttempts: 2, now: () => base, jobTimeoutMs: 20 });
    const id = await scheduleJob('test.hang', secondsFrom(-1), null);

    await scheduler.tick();

    const row = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.lastError).toMatch(/timed out/);
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

  it('waits for an in-flight tick before stop resolves', async () => {
    let started = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: JobHandler = {
      type: 'test.slow',
      run: async () => {
        started = true;
        await gate;
      },
    };
    const id = await scheduleJob('test.slow', secondsFrom(-1), null);
    const scheduler = new Scheduler({ handlers: [handler], log: silentLog(), intervalMs: 10 });

    scheduler.start();
    await vi.waitFor(() => expect(started).toBe(true));

    const stopping = scheduler.stop();
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('running');

    release();
    await stopping;

    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('done');
  });
});
