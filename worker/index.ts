import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { prisma } from '@/lib/db';
import { QUEUE_NAME, requeue, getQueue, getRedis, type JobData } from '@/lib/queue';
import { generateArticle } from '@/lib/pipeline/generate';
import { generateFeaturedImage } from '@/lib/pipeline/image';
import { insertInlineImages } from '@/lib/pipeline/inlineImages';
import { generateTranslation } from '@/lib/pipeline/translate';
import { publishArticle } from '@/lib/pipeline/publish';
import { createTranslationJobs, dispatchDue, planSchedule } from '@/lib/pipeline/schedule';
import { getPublishAdapter } from '@/lib/providers/publish';
import { runQualityLoop } from '@/lib/pipeline/quality';
import { runSiteAudit } from '@/lib/pipeline/siteAudit';
import { interlinkArticle } from '@/lib/pipeline/interlink';
import { scanPool } from '@/lib/pipeline/conflicts';
import { translateExistingContent } from '@/lib/pipeline/translateExisting';
import { checkBudget } from '@/lib/budget';
import { backupConfig, runBackup } from '@/lib/backup';
import { notify } from '@/lib/notify';
import { AllProvidersFailedError } from '@/lib/providers/pool';
import { seedCredentialsFromLegacy } from '@/lib/providers/migrate';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 3);

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/** Model cagrisi yapan, yani para harcayan is turleri */
const PAID: JobData['type'][] = ['generate', 'quality', 'image', 'translate', 'audit', 'interlink', 'xlate'];

async function handle(job: Job<JobData>): Promise<unknown> {
  const data = job.data;
  log('->', data.type, 'articleId' in data ? data.articleId : '');

  // Butce tavani: sinir asildiysa ucretli isler baslatilmaz
  if (PAID.includes(data.type)) {
    const budget = await checkBudget(data.type);
    if (!budget.allowed) {
      log('butce doldu, is atlandi:', data.type);
      if ('articleId' in data) {
        await prisma.article
          .update({
            where: { id: data.articleId },
            data: {
              lastError: `Aylık bütçe doldu (${budget.spent.toFixed(2)} / ${budget.limit} USD). Üretim durduruldu.`,
            },
          })
          .catch(() => undefined);
      }
      return { skipped: 'budget' };
    }
  }

  switch (data.type) {
    // ------------------------------------------------------------- planlama
    case 'plan': {
      const res = await planSchedule();
      if (res.created) log('takvime eklendi:', res.created);
      return res;
    }

    case 'dispatch': {
      const res = await dispatchDue();
      if (res.generate || res.publish || res.translate) log('kuyruga alindi:', res);
      return res;
    }

    // ------------------------------------------------------------- uretim
    case 'generate': {
      await generateArticle(data.articleId);
      // requeue: yeniden uretimde eski (tamamlanmis) gorsel isi jobId'si Redis'te
      // kaldigi icin enqueue yinelenen isi yok sayardi; requeue eskiyi silip yeniden ekler.
      await requeue({ type: 'image', articleId: data.articleId });
      return { ok: true };
    }

    case 'image': {
      const article = await prisma.article.findUniqueOrThrow({
        where: { id: data.articleId },
        include: { site: true },
      });

      try {
        await generateFeaturedImage(data.articleId);
      } catch (e) {
        // Gorsel uretilemezse yazi kaybolmasin: incelemeye dussun
        log('gorsel hatasi:', (e as Error).message);
        await prisma.article.update({
          where: { id: data.articleId },
          data: { lastError: `Gorsel uretilemedi: ${(e as Error).message}`.slice(0, 900) },
        });
      }

      // Govde ici gorseller (one cikan gorselden sonra). Basarisiz olursa yazi durmaz.
      await insertInlineImages(data.articleId).catch((e) => {
        log('inline gorsel hatasi:', (e as Error).message);
      });

      // Otomatik yayin yalnizca kalite esigi tutuyorsa; tutmuyorsa incelemeye dusurulur
      const fresh = await prisma.article.findUniqueOrThrow({
        where: { id: data.articleId },
        select: { seoScore: true },
      });
      const passes = (fresh.seoScore ?? 0) >= article.site.minSeoScore;

      await prisma.article.update({
        where: { id: data.articleId },
        data: {
          status: article.site.autoPublish && passes ? 'APPROVED' : 'NEEDS_REVIEW',
          lastError:
            article.site.autoPublish && !passes
              ? `Kalite puanı ${fresh.seoScore}, eşik ${article.site.minSeoScore}. Otomatik yayın durduruldu.`
              : undefined,
        },
      });

      const n = await createTranslationJobs(data.articleId);
      if (n) log('ceviri kaydi acildi:', n);

      // Otomatik sitelerde ve kalite esigi tutuyorsa yayina gonder
      if (article.site.autoPublish && passes) {
        await requeue({ type: 'publish', articleId: data.articleId });
      }
      return { ok: true };
    }

    case 'quality': {
      const out = await runQualityLoop(data.articleId);
      const a = await prisma.article.findUniqueOrThrow({
        where: { id: data.articleId },
        include: { site: true },
      });
      // Kalite dongusu bittikten sonra dogru duruma don
      if (a.status === 'REVISING') {
        await prisma.article.update({
          where: { id: data.articleId },
          data: {
            status:
              a.site.autoPublish && out.report.score >= a.site.minSeoScore
                ? 'APPROVED'
                : 'NEEDS_REVIEW',
          },
        });
      }
      return { score: out.report.score, rounds: out.rounds.length - 1 };
    }

    case 'interlink': {
      const res = await interlinkArticle(data.articleId);
      return { inserted: res.inserted.length, candidates: res.candidates };
    }

    case 'conflicts': {
      const res = await scanPool(data.siteId);
      if (res.flagged) log('cakisma bulundu:', res.flagged, '/', res.scanned);
      return res;
    }

    case 'xlate': {
      const res = await translateExistingContent(data);
      log('ceviri:', data.targetLang, res.status, res.url);
      return res;
    }

    case 'backup': {
      const res = await runBackup({ trigger: 'auto' });
      log('yedek alindi:', res.file, res.bytes, 'byte', res.pruned ? `(${res.pruned} eski silindi)` : '');
      return res;
    }

    case 'audit': {
      const res = await runSiteAudit(data.siteId);
      return { score: res.score, findings: res.findings.length };
    }

    case 'translate': {
      await generateTranslation(data.articleId);
      const a = await prisma.article.findUniqueOrThrow({
        where: { id: data.articleId },
        include: { site: true },
      });
      if (a.site.autoPublish) await requeue({ type: 'publish', articleId: data.articleId });
      return { ok: true };
    }

    // ------------------------------------------------------------- yayin
    case 'publish': {
      const res = await publishArticle(data.articleId, { force: data.force });

      const article = await prisma.article.findUnique({
        where: { id: data.articleId },
        select: { topicId: true, parentId: true, status: true },
      });

      // Kaynak yazi yayinlandiysa konuyu kapat
      if (article?.topicId && !article.parentId && article.status === 'PUBLISHED') {
        await prisma.topic.update({
          where: { id: article.topicId },
          data: { status: 'DONE' },
        });
      }
      return res;
    }

    // ------------------------------------------------------------- kesif
    case 'discover': {
      const site = await prisma.site.findUniqueOrThrow({ where: { id: data.siteId } });
      const adapter = getPublishAdapter(site);
      const caps = await adapter.discover();

      await prisma.site.update({
        where: { id: site.id },
        data: {
          capabilities: caps as unknown as object,
          hasBridge: caps.bridge?.installed ?? false,
          seoPlugin: caps.seoPlugin,
          lastCheckAt: new Date(),
          lastCheckOk: caps.reachable,
          lastCheckMsg: caps.message.slice(0, 500),
        },
      });
      return caps;
    }

    default:
      throw new Error(`Bilinmeyen is turu: ${JSON.stringify(data)}`);
  }
}

async function main() {
  const queue = getQueue();

  // Zombi kayit temizligi: onceki worker aniden kapandiysa (reboot/kill) "RUNNING"
  // kalmis JobRun'lari kapat. Boylece istatistik/kayitlar sahte "isleniyor" gostermez.
  const zombie = await prisma.jobRun
    .updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
      data: {
        status: 'FAILED',
        message: 'Worker yeniden başladı; yarım kalan iş kaydı kapatıldı.',
        finishedAt: new Date(),
      },
    })
    .catch(() => ({ count: 0 }));
  if (zombie.count) log(`${zombie.count} zombi iş kaydı temizlendi.`);

  // Eski tek anahtarli ayarlar varsa API havuzuna bir kez tasi
  const tasinan = await seedCredentialsFromLegacy().catch(() => 0);
  if (tasinan) log(`API havuzuna ${tasinan} sağlayıcı taşındı.`);

  // Tekrarlayan isler: planlama saatlik, sevk 5 dakikada bir
  await queue.upsertJobScheduler(
    'plan-hourly',
    { pattern: '7 * * * *', tz: process.env.TZ || 'Europe/Istanbul' },
    { name: 'plan', data: { type: 'plan' } as JobData },
  );
  await queue.upsertJobScheduler(
    'dispatch-5min',
    { every: 5 * 60 * 1000 },
    { name: 'dispatch', data: { type: 'dispatch' } as JobData },
  );

  await queue.upsertJobScheduler(
    'conflicts-daily',
    { pattern: '20 4 * * *', tz: process.env.TZ || 'Europe/Istanbul' },
    { name: 'conflicts', data: { type: 'conflicts' } as JobData },
  );

  // Gunluk veritabani yedegi. Kapaliysa varsa eski zamanlayici temizlenir.
  const backup = backupConfig();
  if (backup.enabled) {
    await queue.upsertJobScheduler(
      'backup-daily',
      { pattern: backup.cron, tz: process.env.TZ || 'Europe/Istanbul' },
      { name: 'backup', data: { type: 'backup' } as JobData },
    );
    log(`Yedekleme acik: "${backup.cron}", son ${backup.keep} yedek tutulur -> ${backup.dir}`);
  } else {
    await queue.removeJobScheduler('backup-daily').catch(() => undefined);
  }

  const worker = new Worker<JobData>(QUEUE_NAME, handle, {
    connection: getRedis(),
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000, // uzun LLM cagrilari icin
  });

  worker.on('completed', (job) => log('OK ', job.name, job.id));
  worker.on('failed', async (job, err) => {
    log('HATA', job?.name, job?.id, err.message);

    const d = job?.data as JobData | undefined;
    // Yedekleme kendi bildirimini gonderiyor: burada tekrar gonderme
    if (d?.type === 'backup') return;
    // Havuzun tamami dustuyse tekrar denemek bosuna: bildirim zaten gitti
    const poolDown = err.name === 'AllProvidersFailedError';
    const finalAttempt = poolDown || (job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false);
    if (!finalAttempt) return;

    if (d && 'articleId' in d) {
      const article = await prisma.article
        .update({
          where: { id: d.articleId },
          data: { status: 'FAILED', lastError: err.message.slice(0, 1500) },
          select: { id: true, title: true, site: { select: { name: true } } },
        })
        .catch(() => null);

      await notify({
        level: 'error',
        title: `Üretim başarısız: ${article?.site.name ?? 'site'}`,
        message: `${article?.title ?? d.articleId}
${err.message.slice(0, 300)}`,
        path: `/yazilar/${d.articleId}`,
        dedupeKey: `article-failed-${d.articleId}`,
      });
      return;
    }

    await notify({
      level: 'error',
      title: `İş başarısız: ${job?.name ?? 'bilinmiyor'}`,
      message: err.message.slice(0, 400),
      path: '/kayitlar',
      dedupeKey: `job-failed-${job?.name ?? 'x'}`,
    });
  });

  log(`Worker hazir. Es zamanli is: ${CONCURRENCY}`);

  const shutdown = async () => {
    log('kapatiliyor...');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Worker baslatilamadi:', e);
  process.exit(1);
});
