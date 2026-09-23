import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db.js';
import { addFeed } from '../../../src/modules/dev/lib/feeds.js';
import { ingest } from '../../../src/modules/dev/lib/ingest.js';
import type { NormalizedEvent } from '../../../src/modules/dev/lib/types.js';
import { resetDb } from '../../db.js';

const event = (n: number): NormalizedEvent => ({
  source: 'jira',
  kind: 'issue.done',
  key: 'SD',
  actor: 'acc-1',
  actorName: 'Gui',
  title: `SD-${n} Thing`,
  url: null,
  detail: 'In Progress → Done',
  count: null,
});

describe('ingest', () => {
  beforeEach(resetDb);

  it('survives a burst of concurrent deliveries while other writes run', async () => {
    await addFeed('g1', 'jira', 'SD', 'c1');
    const deliveries = Array.from({ length: 30 }, (_, i) => ingest(`jira:burst-${i}`, [event(i)]));
    const otherWrites = Array.from({ length: 20 }, () =>
      prisma.job.create({ data: { type: 'other.write', runAt: new Date(), payload: 'null' } }),
    );
    const results = await Promise.allSettled([...deliveries, ...otherWrites]);
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures.map((f) => String((f as PromiseRejectedResult).reason).slice(0, 120))).toEqual([]);
    expect(await prisma.devEvent.count()).toBe(30);
    expect(await prisma.job.count({ where: { type: 'dev.notify' } })).toBe(30);
  }, 30_000);
});
