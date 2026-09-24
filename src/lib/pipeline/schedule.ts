import { addDays, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Site } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getBudgetStatus } from '@/lib/budget';
import { enqueue } from '@/lib/queue';

/** Taslak, yayin saatinden bu kadar once uretilir (inceleme payi). */
const LEAD_HOURS = Number(process.env.LEAD_HOURS ?? 36);

/**
 * Site takvimine gore onumuzdeki 14 gunun yayin saatlerini uretir.
 * publishDays haftalik gunler (0=Pazar), weeklyQuota o gunlere dagitilir.
 * Kota gun sayisindan fazlaysa ayni gune birden fazla yazi 2 saat arayla dizilir.
 */
/**
 * Sitenin yayin takvimine gore GELECEK slotlari uretir.
 *
 * `count` kadar slot bulana kadar hafta hafta ilerler (en fazla ~2 yil).
 * Boylece havuzdaki TUM konular bir slota yerlesir; 14 gunluk sabit ufuk
 * yuzunden fazla konular havuzda takili kalmaz.
 */
export function computeSlots(site: Site, from = new Date(), count = 6): Date[] {
  const tz = site.timezone || 'Europe/Istanbul';
  const publishDays = site.publishDays.length ? [...new Set(site.publishDays)].sort() : [1];
  const quota = Math.max(1, site.weeklyQuota);
  const slots: Date[] = [];
  const maxWeeks = 104; // ~2 yil guvenlik tavani

  for (let week = 0; week < maxWeeks && slots.length < count; week++) {
    const weekStart = addDays(startOfWeek(toZonedTime(from, tz), { weekStartsOn: 0 }), week * 7);

    // haftalik kotayi yayin gunlerine dagit
    const perDay: number[] = publishDays.map(() => 0);
    for (let i = 0; i < quota; i++) perDay[i % publishDays.length]++;

    publishDays.forEach((dow, idx) => {
      for (let n = 0; n < perDay[idx]; n++) {
        const local = addDays(weekStart, dow);
        local.setHours(site.publishHour + n * 2, 0, 0, 0);
        const utc = fromZonedTime(local, tz);
        if (utc.getTime() > from.getTime()) slots.push(utc);
      }
    });
  }

  return slots.sort((a, b) => a.getTime() - b.getTime()).slice(0, count);
}

/**
 * Bos takvim slotlarina havuzdaki konulari yerlestirir ve Article kaydi acar.
 * Ayni slot iki kez doldurulmaz; zaten planlanmis yazilar sayilir.
 */
export async function planSchedule(siteId?: string): Promise<{ created: number; sites: number }> {
  const sites = await prisma.site.findMany({
    where: { status: 'ACTIVE', ...(siteId ? { id: siteId } : {}) },
  });

  let created = 0;

  for (const site of sites) {
    // Havuzda bekleyen konu sayisi kadar (+ mevcut planlar) slot uret ki
    // hepsi bir tarihe otursun; fazla konu havuzda takili kalmasin.
    const queuedCount = await prisma.topic.count({
      where: { siteId: site.id, status: 'QUEUED' },
    });
    if (queuedCount === 0) continue;

    // gelecekteki mevcut planlar (kaynak dilli)
    const planned = await prisma.article.findMany({
      where: {
        siteId: site.id,
        parentId: null,
        scheduledFor: { gte: new Date() },
        status: { notIn: ['FAILED'] },
      },
      select: { scheduledFor: true },
    });
    const taken = new Set(planned.map((p) => p.scheduledFor?.getTime()));

    const slots = computeSlots(site, new Date(), queuedCount + planned.length);
    const freeSlots = slots.filter((s) => !taken.has(s.getTime()));
    if (!freeSlots.length) continue;

    const topics = await prisma.topic.findMany({
      where: { siteId: site.id, status: 'QUEUED' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: freeSlots.length,
    });

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const when = freeSlots[i];
      const locale = topic.locale || site.defaultLocale;

      const article = await prisma.article.create({
        data: {
          siteId: site.id,
          topicId: topic.id,
          locale,
          status: 'QUEUED',
          title: topic.title,
          scheduledFor: when,
        },
      });

      await prisma.topic.update({
        where: { id: topic.id },
        data: { status: 'SCHEDULED', scheduledFor: when },
      });

      created++;
      void article;
    }
  }

  return { created, sites: sites.length };
}

/**
 * Zamani gelen isleri kuyruga atar. Worker bunu 5 dakikada bir cagirir.
 *  - Uretim: yayin saatinden LEAD_HOURS once
 *  - Yayin:  yayin saati gelmis ve onaylanmis/otomatik yazilar
 *  - Ceviri: kaynak yazi yayinlandiktan sonra
 */
export async function dispatchDue(): Promise<{ generate: number; publish: number; translate: number }> {
  const now = new Date();

  // Butce dolduysa yeni uretim/ceviri kuyruga alinmaz; yayin isleri devam eder
  // (bunlar ucretsizdir ve bekleyen onayli yazilarin gitmesi gerekir).
  const budget = await getBudgetStatus();
  const canProduce = budget.allowed;
  const leadCutoff = new Date(now.getTime() + LEAD_HOURS * 3600_000);

  // ---- 1. uretilecekler
  const toGenerate = canProduce
    ? await prisma.article.findMany({
        where: { status: 'QUEUED', parentId: null, scheduledFor: { lte: leadCutoff } },
        select: { id: true },
        take: 50,
      })
    : [];
  for (const a of toGenerate) await enqueue({ type: 'generate', articleId: a.id });

  // ---- 2. yayinlanacaklar
  const toPublish = await prisma.article.findMany({
    where: {
      status: 'APPROVED',
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    select: { id: true },
    take: 50,
  });
  for (const a of toPublish) await enqueue({ type: 'publish', articleId: a.id });

  // ---- 3. cevrilecekler
  const toTranslate = canProduce
    ? await prisma.article.findMany({
        where: { status: 'QUEUED', parentId: { not: null } },
        select: { id: true, parent: { select: { status: true } } },
        take: 50,
      })
    : [];
  let translateCount = 0;
  for (const a of toTranslate) {
    if (a.parent?.status === 'PUBLISHED' || a.parent?.status === 'APPROVED') {
      await enqueue({ type: 'translate', articleId: a.id });
      translateCount++;
    }
  }

  return { generate: toGenerate.length, publish: toPublish.length, translate: translateCount };
}

/**
 * Kaynak yazi hazir olunca ceviri kayitlarini acar.
 * SIBLING modunda ceviri, o dilin kardes sitesine yazilir.
 */
export async function createTranslationJobs(parentArticleId: string): Promise<number> {
  const parent = await prisma.article.findUniqueOrThrow({
    where: { id: parentArticleId },
    include: { site: true, topic: true },
  });
  const site = parent.site;

  const targets = (
    parent.topic?.targetLocales.length ? parent.topic.targetLocales : site.locales
  ).filter((l) => l && l !== parent.locale);

  if (!targets.length) return 0;

  let count = 0;
  for (const locale of targets) {
    const exists = await prisma.article.findFirst({
      where: { parentId: parent.id, locale },
      select: { id: true },
    });
    if (exists) continue;

    // Hedef site: SIBLING modunda ayni gruptaki dil sitesi
    let targetSiteId = site.id;
    if (site.i18nMode === 'SIBLING' && site.siblingGroup) {
      const sibling = await prisma.site.findFirst({
        where: {
          siblingGroup: site.siblingGroup,
          defaultLocale: locale,
          status: 'ACTIVE',
          id: { not: site.id },
        },
        select: { id: true },
      });
      if (!sibling) continue; // o dil icin kardes site tanimli degil
      targetSiteId = sibling.id;
    }

    await prisma.article.create({
      data: {
        siteId: targetSiteId,
        topicId: parent.topicId,
        parentId: parent.id,
        locale,
        status: 'QUEUED',
        title: parent.title,
        scheduledFor: parent.scheduledFor,
      },
    });
    count++;
  }

  return count;
}
