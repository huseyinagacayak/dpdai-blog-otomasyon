import { prisma } from '@/lib/db';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { analyzeContent, type SeoReport } from '@/lib/quality/analyze';
import { CONTENT, contentRulesBlock, seoRulesBlock, styleRulesBlock } from '@/lib/quality/standards';
import { sanitizeArticleHtml, toPlainText } from './html';
import { runStep } from './log';
import { localeName, systemPrompt } from './prompts';

/* ------------------------------------------------------------------ tipler */

export type CritiqueIssue = {
  severity: 'high' | 'medium' | 'low';
  area: string;
  problem: string;
  fix: string;
};

export type Critique = {
  verdict: 'publish' | 'revise' | 'rewrite';
  editorScore: number;
  strengths: string[];
  issues: CritiqueIssue[];
  /** Doğrulanamayan / riskli iddialar */
  factRisks: string[];
  /** Rakiplerin işlediği ama bu yazıda eksik olan açılar */
  missingAngles: string[];
};

export type QualityOutcome = {
  report: SeoReport;
  critique: Critique | null;
  rounds: { round: number; score: number; wordCount: number; note: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

/* ------------------------------------------------------------------ analiz */

/** Yazinin mevcut halini olcer (model cagrisi yok). */
export function analyzeArticle(a: {
  contentHtml: string | null;
  title: string;
  slug: string | null;
  seo: unknown;
  locale: string;
  site: { wordCountMin: number; wordCountMax: number };
}): SeoReport {
  const seo = (a.seo ?? {}) as Record<string, unknown>;
  return analyzeContent({
    contentHtml: a.contentHtml ?? '',
    title: a.title,
    metaTitle: seo.metaTitle as string,
    metaDescription: seo.metaDescription as string,
    slug: a.slug ?? '',
    focusKeyword: seo.focusKeyword as string,
    imageAlt: seo.imageAlt as string,
    locale: a.locale,
    minWords: a.site.wordCountMin,
    maxWords: a.site.wordCountMax,
  });
}

/* ------------------------------------------------------------------ dongu */

/**
 * Otonom kalite dongusu.
 *
 *   olc -> (AI editor elestirisi) -> hedefli duzeltme -> yeniden olc
 *
 * Site ayarina gore davranir:
 *   OFF        : hicbir sey yapmaz
 *   CHECK      : sadece olcer ve raporu kaydeder
 *   AUTONOMOUS : bulgulari kendi duzeltir, puan hedefe ulasana kadar tur atar
 *
 * Duzeltme iki kanaldan gelir:
 *   1. Mekanik bulgular (uzunluk, yogunluk, ince bolum, klise, okunabilirlik)
 *   2. AI editorun icerik elestirisi (derinlik, ozgunluk, eksik aci, riskli iddia)
 */
export async function runQualityLoop(articleId: string): Promise<QualityOutcome> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true, topic: true },
  });
  const site = article.site;

  let report = analyzeArticle(article);
  const rounds: QualityOutcome['rounds'] = [
    { round: 0, score: report.score, wordCount: report.wordCount, note: 'ilk ölçüm' },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let critique: Critique | null = null;

  if (site.qualityMode === 'OFF') {
    return { report, critique, rounds, tokensIn, tokensOut, costUsd };
  }

  if (site.qualityMode === 'CHECK') {
    await persist(articleId, report, null, rounds);
    return { report, critique, rounds, tokensIn, tokensOut, costUsd };
  }

  /* ----------------------------------------------------------- otonom mod */

  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });
  const system = systemPrompt(site, article.locale);

  // --- 1. AI editor elestirisi (tur basina degil, bir kez)
  critique = await runStep(
    { articleId, siteId: site.id, kind: 'critique', step: 'editor' },
    async () => {
      const res = await provider.complete({
        system:
          'Sen titiz bir yayın editörüsün. Yazıyı yayına hazır mı diye değerlendirirsin. ' +
          'Övgü değil, uygulanabilir düzeltme üretirsin. Sorun yoksa uydurmazsın.',
        prompt: critiquePrompt(article.title, article.contentHtml ?? '', article.locale, {
          keyword: (article.seo as Record<string, unknown> | null)?.focusKeyword as string,
          audience: site.audience,
          brief: article.topic?.notes,
        }),
        model,
        json: true,
        maxTokens: 4000,
        temperature: 0.3,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd += res.costUsd;

      const parsed = parseJson<Critique>(res.text);
      parsed.issues = (parsed.issues ?? []).filter((i) => i.problem && i.fix);
      return {
        result: parsed,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message: `${parsed.verdict} · editör puanı ${parsed.editorScore} · ${parsed.issues.length} bulgu`,
      };
    },
  ).catch(() => null);

  // --- 2. duzeltme turlari
  let contentHtml = article.contentHtml ?? '';
  let seo = { ...((article.seo ?? {}) as Record<string, unknown>) };
  let slug = article.slug ?? '';
  let title = article.title;

  const editorFixes = (critique?.issues ?? [])
    .filter((i) => i.severity !== 'low')
    .map((i) => `${i.problem} → ${i.fix}`);

  for (let round = 1; round <= site.maxRevisions; round++) {
    const contentFixes = report.issues
      .filter((i) => i.level !== 'ok' && i.fix && i.area !== 'meta')
      .map((i) => i.fix as string);
    const metaFixes = report.issues
      .filter((i) => i.level !== 'ok' && i.fix && i.area === 'meta')
      .map((i) => i.fix as string);

    const allContentFixes = round === 1 ? [...contentFixes, ...editorFixes] : contentFixes;
    const done =
      report.score >= site.minSeoScore &&
      !report.issues.some((i) => i.level === 'error') &&
      allContentFixes.length === 0 &&
      metaFixes.length === 0;

    if (done) break;
    if (allContentFixes.length === 0 && metaFixes.length === 0) break;

    await prisma.article.update({ where: { id: articleId }, data: { status: 'REVISING' } });

    // --- 2a. govde duzeltmesi
    if (allContentFixes.length) {
      const revised = await runStep(
        { articleId, siteId: site.id, kind: 'revise', step: `tur-${round}` },
        async () => {
          const res = await provider.complete({
            system,
            prompt: revisionPrompt({
              title,
              contentHtml,
              fixes: allContentFixes,
              wordMin: site.wordCountMin,
              wordMax: site.wordCountMax,
              currentWords: report.wordCount,
              keyword: seo.focusKeyword as string,
              bannedWords: site.bannedWords,
            }),
            model,
            maxTokens: 20000,
            temperature: 0.6,
          });
          tokensIn += res.tokensIn;
          tokensOut += res.tokensOut;
          costUsd += res.costUsd;

          const clean = sanitizeArticleHtml(res.text);
          const w = toPlainText(clean).split(/\s+/).filter(Boolean).length;
          if (w < 200) throw new Error(`Düzeltme çıktısı çok kısa (${w} kelime).`);

          return {
            result: clean,
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
            costUsd: res.costUsd,
            message: `${allContentFixes.length} bulgu · ${w} kelime`,
          };
        },
      ).catch(() => null);

      if (revised) {
        const candidate = analyzeContent({
          contentHtml: revised,
          title,
          metaTitle: seo.metaTitle as string,
          metaDescription: seo.metaDescription as string,
          slug,
          focusKeyword: seo.focusKeyword as string,
          imageAlt: seo.imageAlt as string,
          locale: article.locale,
          minWords: site.wordCountMin,
          maxWords: site.wordCountMax,
        });

        // Duzeltme puani dusurduyse eski metni koru
        if (candidate.score >= report.score) {
          contentHtml = revised;
          report = candidate;
          rounds.push({
            round,
            score: candidate.score,
            wordCount: candidate.wordCount,
            note: `gövde düzeltildi (${allContentFixes.length} bulgu)`,
          });
        } else {
          rounds.push({
            round,
            score: candidate.score,
            wordCount: candidate.wordCount,
            note: `düzeltme puanı düşürdü (${report.score} → ${candidate.score}), eski metin korundu`,
          });
          break;
        }
      }
    }

    // --- 2b. meta duzeltmesi (kucuk, ayri cagri; JSON kesilme riski yok)
    const metaNeeds = report.issues.filter(
      (i) => i.level !== 'ok' && i.fix && i.area === 'meta',
    );
    if (metaNeeds.length) {
      const fixed = await runStep(
        { articleId, siteId: site.id, kind: 'revise', step: `meta-${round}` },
        async () => {
          const res = await provider.complete({
            system,
            prompt: metaFixPrompt({
              title,
              locale: article.locale,
              plain: toPlainText(contentHtml, 3000),
              keyword: seo.focusKeyword as string,
              current: {
                metaTitle: seo.metaTitle as string,
                metaDescription: seo.metaDescription as string,
                slug,
                imageAlt: seo.imageAlt as string,
              },
              fixes: metaNeeds.map((i) => i.fix as string),
            }),
            model,
            json: true,
            maxTokens: 1500,
            temperature: 0.4,
          });
          tokensIn += res.tokensIn;
          tokensOut += res.tokensOut;
          costUsd += res.costUsd;
          return {
            result: parseJson<{
              metaTitle: string;
              metaDescription: string;
              slug: string;
              imageAlt: string;
            }>(res.text),
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
            costUsd: res.costUsd,
            message: `${metaNeeds.length} meta bulgusu`,
          };
        },
      ).catch(() => null);

      if (fixed) {
        seo = {
          ...seo,
          metaTitle: fixed.metaTitle || seo.metaTitle,
          metaDescription: fixed.metaDescription || seo.metaDescription,
          imageAlt: fixed.imageAlt || seo.imageAlt,
        };
        if (fixed.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixed.slug)) slug = fixed.slug;

        report = analyzeContent({
          contentHtml,
          title,
          metaTitle: seo.metaTitle as string,
          metaDescription: seo.metaDescription as string,
          slug,
          focusKeyword: seo.focusKeyword as string,
          imageAlt: seo.imageAlt as string,
          locale: article.locale,
          minWords: site.wordCountMin,
          maxWords: site.wordCountMax,
        });
        rounds.push({
          round,
          score: report.score,
          wordCount: report.wordCount,
          note: 'meta alanları düzeltildi',
        });
      }
    }
  }

  await prisma.article.update({
    where: { id: articleId },
    data: {
      contentHtml,
      slug,
      seo: seo as unknown as object,
      revisionCount: rounds.length - 1,
      tokensIn: { increment: tokensIn },
      tokensOut: { increment: tokensOut },
      costUsd: { increment: costUsd },
    },
  });

  await persist(articleId, report, critique, rounds);

  return { report, critique, rounds, tokensIn, tokensOut, costUsd };
}

async function persist(
  articleId: string,
  report: SeoReport,
  critique: Critique | null,
  rounds: QualityOutcome['rounds'],
) {
  await prisma.article.update({
    where: { id: articleId },
    data: {
      seoScore: report.score,
      seoIssues: report as unknown as object,
      wordCount: report.wordCount,
      critique: critique ? (critique as unknown as object) : undefined,
      scoreHistory: rounds as unknown as object,
    },
  });
}

/* ---------------------------------------------------------------- promptlar */

function critiquePrompt(
  title: string,
  contentHtml: string,
  locale: string,
  ctx: { keyword?: string; audience?: string | null; brief?: string | null },
): string {
  return `Aşağıdaki blog yazısını yayına hazır olup olmadığı açısından değerlendir.
Dil: ${localeName(locale)}.

BAŞLIK: ${title}
${ctx.keyword ? `ODAK KELİME: ${ctx.keyword}` : ''}
${ctx.audience ? `HEDEF KİTLE: ${ctx.audience}` : ''}
${ctx.brief ? `BRIEF: ${ctx.brief}` : ''}

DEĞERLENDİRME ÖLÇÜTLERİ:
1. Derinlik — okuyucu bu yazıyı okuduktan sonra gerçekten bir şey öğreniyor mu,
   yoksa herkesin bildiğini mi tekrar ediyor?
2. Özgünlük — somut örnek, sayı, adım, karşılaştırma var mı; yoksa genel geçer mi?
3. Arama niyeti — başlığın vaat ettiği soruyu gerçekten cevaplıyor mu?
4. Doğruluk riski — doğrulanamayan iddia, uydurma istatistik, sahte kaynak var mı?
5. Yapay zekâ tonu — şişirme sıfat, klişe kalıp, boş geçiş cümlesi var mı?
6. Eksik açı — bu konuda okuyucunun soracağı ama yazının atladığı ne var?

KURALLAR:
- Yalnızca gerçekten var olan sorunları yaz. Sorun yoksa issues dizisini boş bırak.
- Her bulgunun "fix" alanı doğrudan uygulanabilir bir talimat olsun
  ("daha iyi yaz" gibi belirsiz ifade kullanma).
- Meta başlık/açıklama/slug uzunluğu gibi ölçülebilir şeyleri değerlendirme;
  onları ayrı bir mekanizma ölçüyor. Sen içeriğin kendisine odaklan.

YAZI:
${contentHtml}

Şu JSON şemasında yanıt ver:
{
  "verdict": "publish | revise | rewrite",
  "editorScore": 0-100 arası tam sayı,
  "strengths": ["yazının gerçekten iyi olan 1-3 yönü"],
  "issues": [
    { "severity": "high|medium|low", "area": "derinlik|özgünlük|arama niyeti|ton|yapı",
      "problem": "sorun nedir", "fix": "ne yapılmalı, somut talimat" }
  ],
  "factRisks": ["doğrulanamayan veya riskli iddialar, yoksa boş dizi"],
  "missingAngles": ["yazının atladığı açılar, yoksa boş dizi"]
}`;
}

function revisionPrompt(o: {
  title: string;
  contentHtml: string;
  fixes: string[];
  wordMin: number;
  wordMax: number;
  currentWords: number;
  keyword?: string;
  bannedWords: string[];
}): string {
  return `Aşağıdaki yazıyı DÜZELT. Sıfırdan yazma; mevcut metni koruyarak iyileştir.

BAŞLIK: ${o.title}
MEVCUT UZUNLUK: ${o.currentWords} kelime · HEDEF: ${o.wordMin}-${o.wordMax} kelime
${o.keyword ? `ODAK KELİME: ${o.keyword}` : ''}

YAPILACAK DÜZELTMELER (hepsini uygula):
${o.fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}

${contentRulesBlock({ wordMin: o.wordMin, wordMax: o.wordMax, focusKeyword: o.keyword })}

${styleRulesBlock(o.bannedWords)}

ÇIKTI KURALLARI:
- Sadece düzeltilmiş gövde HTML'ini döndür. Açıklama, yorum, değişiklik listesi yazma.
- <html>, <head>, <body> ve H1 kullanma. Kod bloğu ile sarma.
- İzinli etiketler: <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <blockquote> <a>
  <table> <thead> <tbody> <tr> <th> <td>
- Metinde <a href="..."> bağlantısı varsa BİREBİR KORU. Bağlantıları silme, taşıma,
  href değerini değiştirme. Yeni bağlantı da ekleme.
- Doğru olan bölümleri olduğu gibi bırak; yalnızca listelenen sorunları gider.
- Uzatma isteniyorsa dolgu cümle ekleme; somut örnek, sayısal veri, adım listesi,
  sık yapılan hata veya karşılaştırma ekleyerek uzat.

MEVCUT YAZI:
${o.contentHtml}`;
}

function metaFixPrompt(o: {
  title: string;
  locale: string;
  plain: string;
  keyword?: string;
  current: {
    metaTitle?: string;
    metaDescription?: string;
    slug?: string;
    imageAlt?: string;
  };
  fixes: string[];
}): string {
  return `Aşağıdaki yazının SEO meta alanlarını düzelt. Dil: ${localeName(o.locale)}.

BAŞLIK: ${o.title}
${o.keyword ? `ODAK KELİME: ${o.keyword}` : ''}

MEVCUT DEĞERLER:
- metaTitle: ${o.current.metaTitle ?? '(boş)'} (${(o.current.metaTitle ?? '').length} karakter)
- metaDescription: ${o.current.metaDescription ?? '(boş)'} (${(o.current.metaDescription ?? '').length} karakter)
- slug: ${o.current.slug ?? '(boş)'}
- imageAlt: ${o.current.imageAlt ?? '(boş)'}

YAPILACAK DÜZELTMELER:
${o.fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}

${seoRulesBlock()}

YAZININ İÇERİĞİ (kısaltılmış):
${o.plain}

Şu JSON şemasında yanıt ver (dört alanı da doldur, sorunsuz olanları aynen koru):
{ "metaTitle": "", "metaDescription": "", "slug": "", "imageAlt": "" }

Karakter sınırlarına harfiyen uy: metaTitle ${CONTENT.metaTitle.min}-${CONTENT.metaTitle.max},
metaDescription ${CONTENT.metaDescription.min}-${CONTENT.metaDescription.max}.`;
}
