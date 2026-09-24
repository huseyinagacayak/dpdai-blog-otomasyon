import slugify from 'slugify';
import { prisma } from '@/lib/db';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { sanitizeArticleHtml, structureMatches, toPlainText } from './html';
import { runStep } from './log';
import { seoPrompt, systemPrompt, translatePrompt, type Outline, type SeoPack } from './prompts';
import { analyzeContent } from '@/lib/quality/analyze';
import { interlinkArticle } from './interlink';
import { runQualityLoop } from './quality';

/**
 * Ceviri yazisini uretir. Kaynak yazi (parent) onaylandiktan/yayinlandiktan sonra
 * calisir; boylece duzeltilmis metin cevrilir, bosa uretim olmaz.
 */
export async function generateTranslation(articleId: string): Promise<void> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true, parent: true },
  });
  const site = article.site;
  const parent = article.parent;

  if (!parent) throw new Error('Ceviri icin kaynak yazi bulunamadi.');
  if (!parent.contentHtml) throw new Error('Kaynak yazinin metni bos.');

  await prisma.article.update({
    where: { id: articleId },
    data: { status: 'TRANSLATING', lastError: null },
  });

  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });
  const system = systemPrompt(site, article.locale);

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;

  // ---------------------------------------------------------------- 1. ceviri
  const translated = await runStep(
    { articleId, siteId: site.id, kind: 'translate', step: article.locale },
    async () => {
      const res = await provider.complete({
        system,
        prompt: translatePrompt(
          site,
          parent.locale,
          article.locale,
          parent.title,
          parent.contentHtml as string,
        ),
        model,
        json: true,
        maxTokens: 16000,
        temperature: 0.4,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const out = parseJson<{ title: string; contentHtml: string }>(res.text);
      if (!out.title || !out.contentHtml) throw new Error('Ceviri ciktisi eksik.');

      const clean = sanitizeArticleHtml(out.contentHtml);
      if (!structureMatches(parent.contentHtml as string, clean)) {
        throw new Error(
          'Ceviride HTML yapisi kaynaktan onemli olcude sapti (baslik/paragraf sayisi tutmuyor).',
        );
      }

      return {
        result: { title: out.title, contentHtml: clean },
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: `${parent.locale} -> ${article.locale}`,
      };
    },
  );

  // ---------------------------------------------------------------- 2. SEO
  const parentOutline = (parent.outline ?? {}) as Outline;
  const outlineForSeo: Outline = {
    ...parentOutline,
    h1: translated.title,
    // odak kelime hedef dilde yeniden belirlenecek, SEO adimina ipucu birak
    focusKeyword: parentOutline.focusKeyword ?? '',
  };

  const seo = await runStep(
    { articleId, siteId: site.id, kind: 'seo', step: `meta-${article.locale}` },
    async () => {
      const res = await provider.complete({
        system,
        prompt:
          seoPrompt(outlineForSeo, translated.contentHtml, article.locale) +
          `\n\nNOT: Odak anahtar kelimeyi hedef dilde yeniden belirle, kaynak dildeki kelimeyi ceviri olarak kullanma. focusKeyword alanini da JSON'a ekle.`,
        model,
        json: true,
        maxTokens: 3000,
        temperature: 0.5,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const pack = parseJson<SeoPack & { focusKeyword?: string }>(res.text);
      pack.slug = slugify(pack.slug || translated.title, { lower: true, strict: true })
        .split('-')
        .filter(Boolean)
        .slice(0, 7)
        .join('-');
      if (!pack.metaTitle) pack.metaTitle = translated.title.slice(0, 60);
      if (!pack.metaDescription) pack.metaDescription = toPlainText(translated.contentHtml, 155);
      return {
        result: pack,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: pack.slug,
      };
    },
  );

  const focusKeyword = seo.focusKeyword || parentOutline.focusKeyword || '';

  const report = analyzeContent({
    contentHtml: translated.contentHtml,
    title: translated.title,
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    slug: seo.slug,
    focusKeyword,
    imageAlt: seo.imageAlt,
    locale: article.locale,
    minWords: site.wordCountMin,
    maxWords: site.wordCountMax,
  });

  const parentSeo = (parent.seo ?? {}) as Record<string, unknown>;
  const parentSchema = (parentSeo.schema ?? {}) as Record<string, unknown>;

  await prisma.article.update({
    where: { id: articleId },
    data: {
      title: translated.title,
      slug: seo.slug,
      excerpt: seo.excerpt,
      contentHtml: translated.contentHtml,
      outline: outlineForSeo as unknown as object,
      seo: {
        metaTitle: seo.metaTitle,
        metaDescription: seo.metaDescription,
        focusKeyword,
        secondaryKeywords: seo.tags ?? [],
        ogTitle: seo.ogTitle ?? seo.metaTitle,
        ogDescription: seo.ogDescription ?? seo.metaDescription,
        tags: seo.tags ?? [],
        category: seo.category ?? parentSeo.category ?? '',
        imageAlt: seo.imageAlt,
        imageCaption: seo.imageCaption ?? '',
        // Ceviriler kaynagin gorselini paylasir; sema dili guncellenir
        schema: { ...parentSchema, inLanguage: article.locale },
        reuseParentImage: true,
      },
      seoScore: report.score,
      seoIssues: report as unknown as object,
      wordCount: report.wordCount,
      tokensIn,
      tokensOut,
      costUsd,
      status: site.autoPublish ? 'APPROVED' : 'NEEDS_REVIEW',
    },
  });

  // Ceviri de kendi dilindeki yazilara link alsin
  await interlinkArticle(articleId).catch((e) => {
    console.error('[interlink]', (e as Error).message);
  });
}
