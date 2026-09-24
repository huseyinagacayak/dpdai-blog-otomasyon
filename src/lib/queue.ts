import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUE_NAME = 'dpdai-content';

export type JobData =
  | { type: 'generate'; articleId: string }
  | { type: 'image'; articleId: string }
  | { type: 'translate'; articleId: string }
  | { type: 'publish'; articleId: string; force?: boolean }
  | { type: 'discover'; siteId: string }
  | { type: 'audit'; siteId: string }
  | { type: 'quality'; articleId: string }
  | { type: 'interlink'; articleId: string }
  | { type: 'conflicts'; siteId?: string }
  | { type: 'xlate'; siteId: string; sourcePostId: number; targetLang: string }
  | { type: 'backup' }
  | { type: 'plan' }
  | { type: 'dispatch' };

let connection: IORedis | null = null;
let queue: Queue<JobData> | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export function getQueue(): Queue<JobData> {
  if (!queue) {
    queue = new Queue<JobData>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 20_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 2000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
  }
  return queue;
}

/**
 * Ayni is iki kez kuyruga girmesin diye sabit jobId kullanilir.
 * (BullMQ ayni id ile ikinci ekleme istegini yok sayar.)
 *
 * NOT: BullMQ ozel jobId icinde iki nokta (":") kabul etmez -- iki nokta
 * Redis anahtar ayraci olarak kullaniliyor. Bu yuzden ayrac olarak "-" kullaniriz.
 */
export async function enqueue(data: JobData, opts: JobsOptions = {}) {
  const q = getQueue();
  const id =
    'articleId' in data
      ? `${data.type}-${data.articleId}`
      : 'siteId' in data
        ? `${data.type}-${data.siteId}`
        : `${data.type}-${Date.now()}`;

  return q.add(data.type, data, { jobId: id, ...opts });
}

/** Ayni isi yeniden calistirmak icin once eskisini siler. */
export async function requeue(data: JobData, opts: JobsOptions = {}) {
  const q = getQueue();
  const id =
    'articleId' in data ? `${data.type}-${data.articleId}` : `${data.type}-${Date.now()}`;
  await q.remove(id).catch(() => undefined);
  return q.add(data.type, data, { jobId: id, ...opts });
}
