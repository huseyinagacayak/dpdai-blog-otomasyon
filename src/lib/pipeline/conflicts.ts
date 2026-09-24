import { prisma } from '@/lib/db';
import { findConflicts, type Conflict, type ConflictTarget } from '@/lib/quality/similarity';

/**
 * Bir sitedeki tum karsilastirma hedeflerini toplar:
 *  1. Havuzdaki diger konular
 *  2. Bu sistemde uretilmis yazilar
 *  3. Sitede halihazirda yayinda olan yazilar (baglanti testinde cekilip onbelleklenir)
 */
export async function buildTargets(siteId: string, excludeTopicId?: string) {
  const [topics, articles, site] = await Promise.all([
    prisma.topic.findMany({
      where: {
        siteId,
        ...(excludeTopicId ? { id: { not: excludeTopicId } } : {}),
        status: { notIn: ['ARCHIVED'] },
      },
      select: { id: true, title: true, keyword: true },
      take: 500,
    }),
    prisma.article.findMany({
      where: { siteId, parentId: null },
      select: { id: true, title: true, seo: true, remoteUrl: true },
      take: 500,
    }),
    prisma.site.findUnique({ where: { id: siteId }, select: { knownTitles: true } }),
  ]);

  const targets: ConflictTarget[] = [];

  for (const t of topics) {
    targets.push({ title: t.title, keyword: t.keyword, source: 'topic', topicId: t.id });
  }

  for (const a of articles) {
    const seo = (a.seo ?? {}) as Record<string, unknown>;
    targets.push({
      title: a.title,
      keyword: (seo.focusKeyword as string) ?? null,
      source: 'article',
      articleId: a.id,
      url: a.remoteUrl ?? undefined,
    });
  }

  const known = (site?.knownTitles ?? []) as { title: string; url?: string }[];
  for (const k of known) {
    if (k?.title) targets.push({ title: k.title, source: 'site', url: k.url });
  }

  return targets;
}

/** Tek bir konuyu tarar ve bulgulari kaydeder. */
export async function scanTopic(topicId: string): Promise<Conflict[]> {
  const topic = await prisma.topic.findUniqueOrThrow({
    where: { id: topicId },
    select: { id: true, siteId: true, title: true, keyword: true },
  });

  const targets = await buildTargets(topic.siteId, topic.id);
  const conflicts = findConflicts({ title: topic.title, keyword: topic.keyword }, targets);

  await prisma.topic.update({
    where: { id: topicId },
    data: {
      conflicts: conflicts.length ? (conflicts as unknown as object) : undefined,
      conflictAt: new Date(),
    },
  });

  return conflicts;
}

/**
 * Bir sitenin (ya da tum sitelerin) havuzunu bastan tarar.
 * Hedef listesi bir kez kurulur, her konu ona karsi olculur.
 */
export async function scanPool(siteId?: string): Promise<{ scanned: number; flagged: number }> {
  const sites = siteId
    ? [{ id: siteId }]
    : await prisma.site.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });

  let scanned = 0;
  let flagged = 0;

  for (const s of sites) {
    const targets = await buildTargets(s.id);
    const topics = await prisma.topic.findMany({
      where: { siteId: s.id, status: { in: ['QUEUED', 'SCHEDULED'] } },
      select: { id: true, title: true, keyword: true },
      take: 500,
    });

    for (const t of topics) {
      // Konunun kendisini hedef listesinden dusur
      const others = targets.filter((x) => x.topicId !== t.id);
      const conflicts = findConflicts({ title: t.title, keyword: t.keyword }, others);

      await prisma.topic.update({
        where: { id: t.id },
        data: {
          conflicts: conflicts.length ? (conflicts as unknown as object) : undefined,
          conflictAt: new Date(),
        },
      });

      scanned++;
      if (conflicts.length) flagged++;
    }
  }

  return { scanned, flagged };
}
