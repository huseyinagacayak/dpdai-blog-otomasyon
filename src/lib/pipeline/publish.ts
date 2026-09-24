import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { getPublishAdapter, type PublishPayload } from '@/lib/providers/publish';
import { STORAGE_DIR } from './image';
import { runStep } from './log';
import { hasBlockingIssues, type SeoReport } from '@/lib/quality/analyze';
import { analyzeArticle } from './quality';

/**
 * Yaziyi siteye gonderir.
 * - site.autoPublish=false ise WordPress'te "taslak" olarak acilir, panelden onaylanip
 *   tekrar calistirildiginda "yayin" durumuna gecer (ayni external_id, yeni yazi acmaz).
 * - SEO denetiminde "error" varsa otomatik yayin durdurulur; elle onay gerekir.
 */
export async function publishArticle(
  articleId: string,
  opts: { force?: boolean } = {},
): Promise<{ url: string; warnings: string[] }> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true, media: true, parent: true },
  });
  const site = article.site;

  if (!article.contentHtml) throw new Error('Yazinin metni bos, yayinlanamaz.');

  const seo = (article.seo ?? {}) as Record<string, unknown>;

  // --- son bir kalite denetimi (panelde elle duzenlenmis olabilir)
  const report = analyzeArticle(article);

  await prisma.article.update({
    where: { id: articleId },
    data: { seoScore: report.score, seoIssues: report as unknown as object },
  });

  // Otomatik yayin icin iki esik: engelleyici bulgu olmamali ve puan hedefi tutmali.
  // Panelden elle onaylanan yazi da ayni denetimden gecer; gecmek icin "zorla yayinla".
  const wantsPublish = article.status === 'APPROVED' || site.autoPublish;
  if (wantsPublish && !opts.force) {
    const blocked = hasBlockingIssues(report);
    const lowScore = report.score < site.minSeoScore;
    if (blocked || lowScore) {
      const message = blockMessage(report, site.minSeoScore, blocked, lowScore);
      await prisma.article.update({
        where: { id: articleId },
        data: { status: 'NEEDS_REVIEW', lastError: message.slice(0, 1500) },
      });
      throw new Error(message);
    }
  }

  await prisma.article.update({ where: { id: articleId }, data: { status: 'PUBLISHING' } });

  const adapter = getPublishAdapter(site);

  return runStep({ articleId, siteId: site.id, kind: 'publish', step: article.locale }, async () => {
    // ------------------------------------------------------------ 1. gorsel
    let featuredMediaId: number | undefined;

    const featured = article.media.find((m) => m.role === 'FEATURED');
    if (featured?.remoteMediaId) {
      featuredMediaId = featured.remoteMediaId;
    } else if (featured?.localPath) {
      const abs = path.join(STORAGE_DIR, featured.localPath);
      const buffer = await readFile(abs);
      const uploaded = await adapter.uploadMedia({
        buffer,
        filename: path.basename(abs),
        mimeType: featured.mimeType ?? 'image/webp',
        alt: featured.alt ?? undefined,
        title: featured.title ?? undefined,
        caption: featured.caption ?? undefined,
      });
      featuredMediaId = uploaded.mediaId;
      await prisma.mediaAsset.update({
        where: { id: featured.id },
        data: { remoteMediaId: uploaded.mediaId, remoteUrl: uploaded.url },
      });
    } else if (seo.reuseParentImage && article.parent?.remoteMediaId) {
      // Ceviri, kaynak yazinin ayni sitedeki gorselini kullanir
      featuredMediaId = article.parent.remoteMediaId;
    }

    // --------------------------------------------------- 1b. gövde görselleri
    // INLINE gorseller WordPress'e yuklenir ve govdedeki yerel adres (/api/media/...)
    // gercek medya adresiyle degistirilir. Yayin ici gorseller boylece siteden servis edilir.
    let bodyHtml = article.contentHtml as string;
    for (const m of article.media.filter((x) => x.role === 'INLINE')) {
      if (!m.localPath) continue;
      let url = m.remoteUrl ?? undefined;
      if (!url) {
        const abs = path.join(STORAGE_DIR, m.localPath);
        const buffer = await readFile(abs);
        const uploaded = await adapter.uploadMedia({
          buffer,
          filename: path.basename(abs),
          mimeType: m.mimeType ?? 'image/webp',
          alt: m.alt ?? undefined,
          title: m.title ?? undefined,
          caption: m.caption ?? undefined,
        });
        url = uploaded.url;
        await prisma.mediaAsset.update({
          where: { id: m.id },
          data: { remoteMediaId: uploaded.mediaId, remoteUrl: uploaded.url },
        });
      }
      if (url) bodyHtml = bodyHtml.split(`/api/media/${m.localPath}`).join(url);
    }

    // ------------------------------------------------------------ 2. durum
    const status = decideStatus(article.status, site.autoPublish, site.wpPostStatus, article.scheduledFor);

    // ------------------------------------------------------------ 3. dil
    const i18n = buildI18n(site.i18nMode, article.locale, article.parent?.remotePostId ?? null);

    const payload: PublishPayload = {
      externalId: article.id,
      title: article.title,
      contentHtml: bodyHtml,
      excerpt: article.excerpt ?? undefined,
      slug: article.slug ?? undefined,
      status,
      date:
        status === 'future' && article.scheduledFor
          ? article.scheduledFor.toISOString()
          : undefined,
      categories: [(seo.category as string) || ''].filter(Boolean),
      tags: ((seo.tags as string[]) ?? []).concat(site.defaultTags),
      authorId: site.defaultAuthorId ?? undefined,
      featuredMediaId,
      seo: {
        metaTitle: seo.metaTitle as string,
        metaDescription: seo.metaDescription as string,
        focusKeyword: seo.focusKeyword as string,
        secondaryKeywords: (seo.secondaryKeywords as string[]) ?? [],
        ogTitle: seo.ogTitle as string,
        ogDescription: seo.ogDescription as string,
        schema: seo.schema as Record<string, unknown>,
      },
      i18n,
    };

    const res = await adapter.publish(payload);

    await prisma.article.update({
      where: { id: articleId },
      data: {
        status: res.status === 'publish' ? 'PUBLISHED' : 'NEEDS_REVIEW',
        remotePostId: res.postId,
        remoteUrl: res.url,
        remoteMediaId: featuredMediaId ?? null,
        publishedAt: res.status === 'publish' ? new Date() : null,
        lastError: res.warnings.length ? res.warnings.join(' | ').slice(0, 1000) : null,
      },
    });

    return {
      result: { url: res.url, warnings: res.warnings },
      message: `${res.status} · ${res.url}`,
    };
  });
}

function decideStatus(
  articleStatus: string,
  autoPublish: boolean,
  wpPostStatus: string,
  scheduledFor: Date | null,
): string {
  // Panelden onaylanmissa ya da ZATEN YAYINDAYSA yayinla.
  // (Yayindaki bir yaziyi yeniden gonderirken taslaga dusurmemeliyiz.)
  if (articleStatus === 'APPROVED' || articleStatus === 'PUBLISHED') {
    if (scheduledFor && scheduledFor.getTime() > Date.now() + 60_000) return 'future';
    return 'publish';
  }
  if (autoPublish) {
    if (scheduledFor && scheduledFor.getTime() > Date.now() + 60_000) return 'future';
    return wpPostStatus === 'draft' ? 'draft' : 'publish';
  }
  return 'draft';
}

function buildI18n(
  mode: string,
  locale: string,
  parentRemotePostId: number | null,
): PublishPayload['i18n'] {
  if (mode === 'POLYLANG') {
    return { mode: 'polylang', lang: locale, translationOfPostId: parentRemotePostId ?? undefined };
  }
  if (mode === 'WPML') {
    return { mode: 'wpml', lang: locale, translationOfPostId: parentRemotePostId ?? undefined };
  }
  return { mode: 'none' };
}

function blockMessage(
  report: SeoReport,
  minScore: number,
  blocked: boolean,
  lowScore: boolean,
): string {
  const parts: string[] = [];
  if (lowScore) parts.push(`Kalite puanı ${report.score}, eşik ${minScore}.`);
  if (blocked) {
    parts.push(
      report.issues
        .filter((i) => i.level === 'error')
        .map((e) => `${e.label}: ${e.detail}`)
        .join(' | '),
    );
  }
  return `Yayın durduruldu. ${parts.join(' ')}`;
}
