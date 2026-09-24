import slugify from 'slugify';
import { prisma } from '@/lib/db';
import { getPublishAdapter, type PublishPayload } from '@/lib/providers/publish';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { analyzeContent } from '@/lib/quality/analyze';
import { sanitizeArticleHtml, toPlainText } from './html';
import { runStep } from './log';
import { seoPrompt, systemPrompt, translatePrompt, type Outline, type SeoPack } from './prompts';

/**
 * SITEDE ZATEN VAR OLAN bir icerigi (yazi/sayfa/urun) hedef dile cevirir ve
 * orijinaline bagli olarak yayinlar. Bizim urettigimiz Article'lardan farkli
 * olarak kaynak, WordPress'ten (dpdai-bridge post-source ucu) cekilir.
 *
 * Akis: kaynak cek -> sektorel ceviri -> hedef dilde SEO -> kalite esigi ->
 * Polylang ile orijinaline bagli yayin (esik tutmuyorsa taslak/inceleme).
 */
export async function translateExistingContent(data: {
  siteId: string;
  sourcePostId: number;
  targetLang: string;
}): Promise<{ url: string; status: string }> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: data.siteId } });
  const adapter = getPublishAdapter(site);
  if (!adapter.postSource) {
    throw new Error('Kaynak içerik çekilemiyor (dpdai-bridge 1.4.0+ gerekli).');
  }

  const src = await adapter.postSource(data.sourcePostId);
  if (!src.contentHtml || toPlainText(src.contentHtml).length < 30) {
    throw new Error('Kaynak içerik boş ya da çok kısa.');
  }

  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });
  const system = systemPrompt(site, data.targetLang);
  const sourceLang = src.lang || site.defaultLocale;

  // ---------------------------------------------------------------- 1. ceviri
  const translated = await runStep(
    { siteId: site.id, kind: 'translate', step: `${sourceLang}→${data.targetLang}` },
    async () => {
      const res = await provider.complete({
        system,
        prompt: translatePrompt(site, sourceLang, data.targetLang, src.title, src.contentHtml),
        model,
        json: true,
        maxTokens: 16000,
        temperature: 0.4,
      });
      const out = parseJson<{ title: string; contentHtml: string }>(res.text);
      if (!out.title || !out.contentHtml) throw new Error('Çeviri çıktısı eksik.');
      return {
        result: { title: out.title, contentHtml: sanitizeArticleHtml(out.contentHtml) },
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: `${sourceLang} → ${data.targetLang} · ${src.title.slice(0, 40)}`,
      };
    },
  );

  // ------------------------------------------------------------------- 2. SEO
  const outline = { h1: translated.title, focusKeyword: '', sections: [] } as unknown as Outline;
  const seo = await runStep(
    { siteId: site.id, kind: 'seo', step: `meta-${data.targetLang}` },
    async () => {
      const res = await provider.complete({
        system,
        prompt:
          seoPrompt(outline, translated.contentHtml, data.targetLang) +
          `\n\nNOT: Odak anahtar kelimeyi hedef dilde belirle ve focusKeyword alanını JSON'a ekle.`,
        model,
        json: true,
        maxTokens: 3000,
        temperature: 0.5,
      });
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

  // ------------------------------------------------------------- 3. kalite esigi
  const focusKeyword = seo.focusKeyword || '';
  const report = analyzeContent({
    contentHtml: translated.contentHtml,
    title: translated.title,
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    slug: seo.slug,
    focusKeyword,
    imageAlt: seo.imageAlt,
    locale: data.targetLang,
    minWords: site.wordCountMin,
    maxWords: site.wordCountMax,
  });
  const passes = report.score >= site.minSeoScore;
  const wpStatus =
    site.autoPublish && passes ? (site.wpPostStatus === 'draft' ? 'draft' : 'publish') : 'draft';

  // -------------------------------------------------- 4. orijinaline bagli yayin
  const payload: PublishPayload = {
    externalId: `xlate-${data.sourcePostId}-${data.targetLang}`,
    title: translated.title,
    contentHtml: translated.contentHtml,
    excerpt: seo.excerpt,
    slug: seo.slug,
    status: wpStatus,
    categories: [(seo.category as string) || ''].filter(Boolean),
    tags: (seo.tags ?? []).concat(site.defaultTags),
    authorId: site.defaultAuthorId ?? undefined,
    seo: {
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      focusKeyword,
      secondaryKeywords: seo.tags ?? [],
      ogTitle: seo.ogTitle ?? seo.metaTitle,
      ogDescription: seo.ogDescription ?? seo.metaDescription,
      schema: { '@context': 'https://schema.org', '@type': 'Article', inLanguage: data.targetLang },
    },
    i18n: {
      mode: site.i18nMode === 'WPML' ? 'wpml' : 'polylang',
      lang: data.targetLang,
      translationOfPostId: data.sourcePostId,
    },
  };

  return runStep(
    { siteId: site.id, kind: 'publish', step: `xlate-${data.targetLang}` },
    async () => {
      const r = await adapter.publish(payload);
      return {
        result: { url: r.url, status: r.status },
        message: `puan ${report.score} · ${r.status} · ${r.url}`,
      };
    },
  );
}
