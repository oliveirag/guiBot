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

// SQLite has one writer. Concurrent interactive transactions time out waiting on each other under a
// burst (a Jira bulk transition), so deliveries are ingested one at a time in this process.
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * Stores one delivery's events and queues a dev.notify job per subscribed channel, all or nothing.
 * `deliveryId` is "<source>:<header id>"; each event is stored as "<deliveryId>#<index>".
 */
export function ingest(deliveryId: string, events: NormalizedEvent[], now = new Date()): Promise<IngestResult> {
  if (events.length === 0) return Promise.resolve({ duplicate: false, stored: 0, queued: 0 });
  return serialized(() => ingestNow(deliveryId, events, now));
}

async function ingestNow(deliveryId: string, events: NormalizedEvent[], now: Date): Promise<IngestResult> {
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
