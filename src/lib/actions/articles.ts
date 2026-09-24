'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sanitizeArticleHtml } from '@/lib/pipeline/html';
import { analyzeContent } from '@/lib/quality/analyze';
import { enqueue, requeue } from '@/lib/queue';

/** Panelde yapilan elle duzenlemeleri kaydeder ve SEO puanini tazeler. */
export async function saveArticle(id: string, fd: FormData) {
  await requireSession();

  const article = await prisma.article.findUniqueOrThrow({
    where: { id },
    include: { site: true },
  });
  const seo = (article.seo ?? {}) as Record<string, unknown>;

  const contentHtml = sanitizeArticleHtml(String(fd.get('contentHtml') ?? ''));
  const title = String(fd.get('title') ?? '').trim();
  const slug = String(fd.get('slug') ?? '').trim();
  const metaTitle = String(fd.get('metaTitle') ?? '').trim();
  const metaDescription = String(fd.get('metaDescription') ?? '').trim();
  const focusKeyword = String(fd.get('focusKeyword') ?? '').trim();
  const excerpt = String(fd.get('excerpt') ?? '').trim();
  const imageAlt = String(fd.get('imageAlt') ?? '').trim();
  const category = String(fd.get('category') ?? '').trim();
  const tags = String(fd.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const report = analyzeContent({
    contentHtml,
    title,
    metaTitle,
    metaDescription,
    slug,
    focusKeyword,
    imageAlt,
    locale: article.locale,
    minWords: article.site.wordCountMin,
    maxWords: article.site.wordCountMax,
  });

  await prisma.article.update({
    where: { id },
    data: {
      title,
      slug,
      excerpt,
      contentHtml,
      seo: { ...seo, metaTitle, metaDescription, focusKeyword, imageAlt, category, tags },
      seoScore: report.score,
      seoIssues: report as unknown as object,
      wordCount: report.wordCount,
    },
  });

  const featured = await prisma.mediaAsset.findFirst({
    where: { articleId: id, role: 'FEATURED' },
  });
  if (featured && imageAlt) {
    await prisma.mediaAsset.update({ where: { id: featured.id }, data: { alt: imageAlt } });
  }

  revalidatePath(`/yazilar/${id}`);
}

/** Onayla: yayin saati geldiyse hemen, gelmediyse zamaninda gonderilir. */
export async function approveArticle(id: string) {
  await requireSession();
  await prisma.article.update({
    where: { id },
    data: { status: 'APPROVED', lastError: null },
  });

  const a = await prisma.article.findUniqueOrThrow({
    where: { id },
    select: { scheduledFor: true },
  });
  if (!a.scheduledFor || a.scheduledFor.getTime() <= Date.now()) {
    await requeue({ type: 'publish', articleId: id });
  }

  revalidatePath(`/yazilar/${id}`);
  revalidatePath('/yazilar');
}

/** SEO uyarilarina ragmen yayinla. */
export async function forcePublish(id: string) {
  await requireSession();
  await prisma.article.update({ where: { id }, data: { status: 'APPROVED', lastError: null } });
  await requeue({ type: 'publish', articleId: id, force: true });
  revalidatePath(`/yazilar/${id}`);
}

/** Metni bastan urettir. */
export async function regenerateArticle(id: string) {
  await requireSession();
  await prisma.article.update({ where: { id }, data: { status: 'QUEUED', lastError: null } });
  await requeue({ type: 'generate', articleId: id });
  revalidatePath(`/yazilar/${id}`);
}

/** Kalite dongusunu yeniden calistir (elle duzenleme sonrasi ya da puani yukseltmek icin). */
export async function rerunQuality(id: string) {
  await requireSession();
  await prisma.article.update({ where: { id }, data: { lastError: null } });
  await requeue({ type: 'quality', articleId: id });
  revalidatePath(`/yazilar/${id}`);
}

/** Ic linkleri yeniden yerlestir. */
export async function rerunInterlink(id: string) {
  await requireSession();
  await requeue({ type: 'interlink', articleId: id });
  revalidatePath(`/yazilar/${id}`);
}

/** Sadece gorseli yeniden urettir. */
export async function regenerateImage(id: string) {
  await requireSession();
  // Durumu hemen guncelle: kuyruk dolu olsa bile panelde "isleniyor" gorunsun.
  await prisma.article.update({ where: { id }, data: { status: 'IMAGING', lastError: null } });
  await requeue({ type: 'image', articleId: id });
  revalidatePath(`/yazilar/${id}`);
}

/**
 * Kapagi UCRETSIZ yeniler: saklanan ham fotodan yeniden olusturur (yeni gorsel
 * uretmez). Ham foto yoksa (eski kayit) tam yeniden uretime duser.
 */
export async function recomposeCover(id: string) {
  await requireSession();
  const { recomposeFeatured } = await import('@/lib/pipeline/image');
  const ok = await recomposeFeatured(id).catch(() => false);
  if (!ok) {
    await prisma.article.update({ where: { id }, data: { status: 'IMAGING', lastError: null } });
    await requeue({ type: 'image', articleId: id });
  }
  revalidatePath(`/yazilar/${id}`);
}

/** Basarisiz isi tekrar dene. */
export async function retryArticle(id: string) {
  await requireSession();
  const a = await prisma.article.findUniqueOrThrow({
    where: { id },
    select: { contentHtml: true, parentId: true },
  });

  if (!a.contentHtml) {
    await prisma.article.update({ where: { id }, data: { status: 'QUEUED', lastError: null } });
    await requeue({ type: a.parentId ? 'translate' : 'generate', articleId: id });
  } else {
    await prisma.article.update({
      where: { id },
      data: { status: 'NEEDS_REVIEW', lastError: null },
    });
  }
  revalidatePath(`/yazilar/${id}`);
}

export async function deleteArticle(id: string) {
  await requireSession();
  const a = await prisma.article.findUnique({ where: { id }, select: { topicId: true } });
  await prisma.article.delete({ where: { id } });
  if (a?.topicId) {
    await prisma.topic.update({
      where: { id: a.topicId },
      data: { status: 'QUEUED', scheduledFor: null },
    });
  }
  revalidatePath('/yazilar');
}

/** Konuyu simdi urettir (takvimi beklemeden). */
export async function runNow(topicId: string) {
  await requireSession();
  const topic = await prisma.topic.findUniqueOrThrow({
    where: { id: topicId },
    include: { site: true },
  });

  const article = await prisma.article.create({
    data: {
      siteId: topic.siteId,
      topicId: topic.id,
      locale: topic.locale || topic.site.defaultLocale,
      status: 'QUEUED',
      title: topic.title,
      scheduledFor: new Date(),
    },
  });

  await prisma.topic.update({ where: { id: topicId }, data: { status: 'RUNNING' } });
  await enqueue({ type: 'generate', articleId: article.id });

  revalidatePath('/konular');
  revalidatePath('/yazilar');
}
