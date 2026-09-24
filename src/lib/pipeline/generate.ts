import * as cheerio from 'cheerio';
import slugify from 'slugify';
import { prisma } from '@/lib/db';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { CONTENT } from '@/lib/quality/standards';
import { sanitizeArticleHtml, toPlainText } from './html';
import { normalizeHeadings, normalizeHeadingText } from './headings';
import { runStep } from './log';
import {
  draftPrompt,
  outlinePrompt,
  seoPrompt,
  systemPrompt,
  type Outline,
  type SeoPack,
} from './prompts';
import { interlinkArticle } from './interlink';
import { runQualityLoop } from './quality';

function safeSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, locale: 'tr' })
    .split('-')
    .filter(Boolean)
    .slice(0, CONTENT.slug.maxWords)
    .join('-');
}

/**
 * Ana uretim hatti:
 *   plan -> tam metin -> SEO paketi -> otonom kalite dongusu
 *
 * Gorsel ve ceviri ayri islerde yurur (sira worker/index.ts icinde).
 */
export async function generateArticle(articleId: string): Promise<void> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true, topic: true },
  });
  const { site } = article;

  if (!article.topic) throw new Error('Yazıya bağlı konu bulunamadı.');
  const topic = article.topic;

  await prisma.article.update({
    where: { id: articleId },
    data: { status: 'DRAFTING', lastError: null, revisionCount: 0 },
  });

  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });
  const system = systemPrompt(site, article.locale);

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;

  /* ---------------------------------------------------------------- 1. plan */

  const outline = await runStep(
    { articleId, siteId: site.id, kind: 'outline', step: 'plan' },
    async () => {
      const res = await provider.complete({
        system,
        prompt: outlinePrompt(site, topic, article.locale),
        model,
        json: true,
        maxTokens: 3000,
        temperature: 0.6,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const parsed = parseJson<Outline>(res.text);
      if (!parsed.h1 || !parsed.sections?.length) {
        throw new Error('Plan çıktı doğrulaması başarısız: h1 veya sections boş.');
      }
      // Baslik duzeni: ilk harf buyuk + kisaltmalar (POS/KDV...). Model bazen
      // kucuk harf donuyor; hem WP baslik hem kapak tutarli olsun.
      parsed.h1 = normalizeHeadingText(parsed.h1);
      // Model bazen basliga marka adini ekliyor ("... rehberi, MovePay");
      // WP zaten site adini basliga ekler, bu yuzden sondaki markayi temizle.
      const brand = site.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (brand) {
        parsed.h1 = parsed.h1.replace(new RegExp(`\\s*[,|\\-–—:]\\s*${brand}\\s*$`, 'i'), '').trim();
      }
      if (topic.keyword) parsed.focusKeyword = topic.keyword;

      return {
        result: parsed,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: `${parsed.sections.length} bölüm · "${parsed.focusKeyword}"`,
      };
    },
  );

  await prisma.article.update({
    where: { id: articleId },
    data: { outline: outline as unknown as object, title: outline.h1 },
  });

  /* --------------------------------------------------------------- 2. metin */

  const contentHtml = await runStep(
    { articleId, siteId: site.id, kind: 'draft', step: 'metin' },
    async () => {
      const res = await provider.complete({
        system,
        prompt: draftPrompt(site, topic, outline),
        model,
        maxTokens: 20000,
        temperature: 0.75,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const clean = normalizeHeadings(sanitizeArticleHtml(res.text));
      const words = toPlainText(clean).split(/\s+/).filter(Boolean).length;
      if (words < 200) throw new Error(`Üretilen metin çok kısa (${words} kelime).`);

      return {
        result: clean,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: `${words} kelime`,
      };
    },
  );

  /* ----------------------------------------------------------------- 3. SEO */

  const seo = await runStep(
    { articleId, siteId: site.id, kind: 'seo', step: 'meta' },
    async () => {
      const res = await provider.complete({
        system,
        prompt: seoPrompt(outline, contentHtml, article.locale),
        model,
        json: true,
        maxTokens: 3000,
        temperature: 0.5,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const pack = parseJson<SeoPack>(res.text);
      pack.slug = safeSlug(pack.slug || outline.h1);
      if (!pack.metaTitle) pack.metaTitle = outline.h1.slice(0, CONTENT.metaTitle.max);
      if (!pack.metaDescription) {
        pack.metaDescription = toPlainText(contentHtml, CONTENT.metaDescription.max);
      }
      if (!pack.tags?.length) pack.tags = outline.tags ?? [];
      if (!pack.category) pack.category = outline.category;

      return {
        result: pack,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: pack.slug,
      };
    },
  );

  const schema = buildSchema(site, outline, seo, article.locale, contentHtml);

  await prisma.article.update({
    where: { id: articleId },
    data: {
      title: outline.h1,
      slug: seo.slug,
      excerpt: seo.excerpt,
      contentHtml,
      seo: {
        metaTitle: seo.metaTitle,
        metaDescription: seo.metaDescription,
        focusKeyword: outline.focusKeyword,
        secondaryKeywords: outline.secondaryKeywords ?? [],
        ogTitle: seo.ogTitle ?? seo.metaTitle,
        ogDescription: seo.ogDescription ?? seo.metaDescription,
        tags: seo.tags,
        category: seo.category,
        internalLinkSuggestions: seo.internalLinkSuggestions ?? [],
        imageBrief: seo.imageBrief ?? null,
        imageAlt: seo.imageAlt,
        imageCaption: seo.imageCaption ?? '',
        schema,
      } as unknown as object,
      tokensIn,
      tokensOut,
      costUsd,
    },
  });

  /* -------------------------------------------------- 4. kalite döngüsü */

  await runQualityLoop(articleId);

  // Kalite döngüsü gövdeyi yeniden yazmış olabilir; başlık düzenini yeniden garanti et
  const afterQuality = await prisma.article.findUnique({
    where: { id: articleId },
    select: { contentHtml: true },
  });
  if (afterQuality?.contentHtml) {
    const normalized = normalizeHeadings(afterQuality.contentHtml);
    if (normalized !== afterQuality.contentHtml) {
      await prisma.article.update({
        where: { id: articleId },
        data: { contentHtml: normalized },
      });
    }
  }

  /* --------------------------------------------------- 5. iç linkleme */
  // Kalite döngüsünden SONRA çalışır: düzeltme turu gövdeyi yeniden yazdığı için
  // daha önce konmuş linkler kaybolurdu.
  await interlinkArticle(articleId).catch((e) => {
    console.error('[interlink]', (e as Error).message);
  });

  await prisma.article.update({
    where: { id: articleId },
    data: { status: 'IMAGING' },
  });
}

/* ------------------------------------------------------------------ schema */

/** Article schema.org JSON-LD - SSS cevaplari govdeden okunur */
function buildSchema(
  site: { name: string; url: string },
  outline: Outline,
  seo: SeoPack,
  locale: string,
  contentHtml: string,
): Record<string, unknown> {
  const article: Record<string, unknown> = {
    '@type': 'BlogPosting',
    headline: outline.h1,
    description: seo.metaDescription,
    inLanguage: locale,
    keywords: [outline.focusKeyword, ...(outline.secondaryKeywords ?? [])].join(', '),
    publisher: { '@type': 'Organization', name: site.name, url: site.url },
  };

  const graph: Record<string, unknown>[] = [article];

  const faq = extractFaq(contentHtml);
  if (faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * "Sık Sorulan Sorular" H2'sinden sonraki H3 + P ciftlerini toplar.
 * Cevabi bos olan sorular schema'ya girmez (Google bunu gecersiz sayar).
 */
function extractFaq(contentHtml: string): { q: string; a: string }[] {
  const $ = cheerio.load(contentHtml || '', null, false);
  const out: { q: string; a: string }[] = [];

  const faqHeading = $('h2')
    .toArray()
    .find((el) =>
      /sık sorulan|sik sorulan|faq|frequently asked|häufig|preguntas frecuentes|questions fréquentes/i.test(
        $(el).text(),
      ),
    );
  if (!faqHeading) return out;

  let node = $(faqHeading).next();
  let current: string | null = null;
  let answer: string[] = [];

  const flush = () => {
    if (current && answer.length) out.push({ q: current, a: answer.join(' ').trim() });
    current = null;
    answer = [];
  };

  while (node.length && node.get(0)?.tagName?.toLowerCase() !== 'h2') {
    const tag = node.get(0)?.tagName?.toLowerCase();
    if (tag === 'h3' || tag === 'h4') {
      flush();
      current = node.text().trim();
    } else if (current && (tag === 'p' || tag === 'ul' || tag === 'ol')) {
      answer.push(node.text().replace(/\s+/g, ' ').trim());
    }
    node = node.next();
  }
  flush();

  return out.filter((f) => f.q && f.a.length > 20);
}
