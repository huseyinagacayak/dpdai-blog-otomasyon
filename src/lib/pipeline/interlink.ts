import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { prisma } from '@/lib/db';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { CONTENT } from '@/lib/quality/standards';
import { runStep } from './log';
import { localeName } from './prompts';
import { getSiteIndex } from './siteIndex';

/* ------------------------------------------------------------------ tipler */

type Candidate = {
  /** "a:<articleId>" = bizim urettigimiz yazi, "s:<n>" = sitenin mevcut sayfasi */
  id: string;
  title: string;
  url: string;
  kind: 'article' | 'site';
  /** Insan okunur tur etiketi: yazı / ürün / hizmet / iletişim / kurumsal sayfa */
  type: string;
  articleId?: string;
  focusKeyword?: string;
  /** Su an kac yazidan link aliyor (az alan tercih edilir) */
  inbound: number;
  /** post | page | sitemap - sitenin mevcut sayfalari icin */
  source?: string;
};

/**
 * Site sayfasini URL'ine gore siniflandirir. Boylece modele "bu bir urun /
 * hizmet / iletisim sayfasi" bilgisini verip DOGRU hedefe link vermesini
 * saglariz; istenmeyen turleri (case study, etiket/kategori arsivi) eleriz.
 *
 * Donen '' (bos) => aday havuzundan cikarilir.
 */
function classifySitePage(url: string): string {
  const p = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  // Istenmeyenler: link hedefi olmamali
  if (/\/(case-study|case-studies|basari-hikaye|referans|portfolio|portfoy|proje)s?\//.test(p)) return '';
  if (/\/(category|kategori|tag|etiket|author|yazar|date|tarih)\//.test(p)) return '';

  if (/\/(iletisim|contact|bize-ulasin|ulasin)\b/.test(p)) return 'iletişim';
  if (/\/(urun|urunler|product|products|shop|magaza|mağaza)\b/.test(p)) return 'ürün';
  if (/\/(hizmet|hizmetler|service|services|cozum|çözüm|cozumler|çözümler|solution|solutions|pos|pos-cihazlari)\b/.test(p))
    return 'hizmet';
  if (/\/(hakkimizda|about|kurumsal|sss|faq|blog|kariyer|career)\b/.test(p)) return 'kurumsal sayfa';
  return 'sayfa';
}

type Choice = { anchor: string; targetId: string; reason?: string };

export type InterlinkResult = {
  inserted: { anchor: string; targetId: string; url: string }[];
  skipped: { anchor: string; reason: string }[];
  candidates: number;
};

/* ---------------------------------------------------------------- aday havuzu */

/**
 * Ayni site + ayni dildeki yayinlanmis yazilar.
 * Az ic link alan yazilar one alinir; boylece "yetim yazi" birikmez.
 */
async function buildIndex(
  siteId: string,
  locale: string,
  excludeId: string,
  excludeUrl: string | null,
  limit = 70,
): Promise<Candidate[]> {
  // --- 1. Bu sistemde uretilmis, yayinlanmis yazilar
  const rows = await prisma.article.findMany({
    where: {
      siteId,
      locale,
      id: { not: excludeId },
      status: 'PUBLISHED',
      remoteUrl: { not: null },
    },
    orderBy: { publishedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      remoteUrl: true,
      seo: true,
      _count: { select: { inboundLinks: true } },
    },
  });

  const mine: Candidate[] = rows.map((r) => {
    const seo = (r.seo ?? {}) as Record<string, unknown>;
    return {
      id: `a:${r.id}`,
      title: r.title,
      url: r.remoteUrl as string,
      kind: 'article' as const,
      type: 'yazı',
      articleId: r.id,
      focusKeyword: (seo.focusKeyword as string) ?? '',
      inbound: r._count.inboundLinks,
    };
  });

  // --- 2. Sitenin kendi sayfalari (urun, hizmet, iletisim, kurumsal sayfa)
  // Ilk yazi bile linksiz kalmasin diye sitemap/REST dizini kullanilir.
  // Istenmeyen turler (case study, kategori/etiket arsivi) elenir.
  const known = await getSiteIndex(siteId).catch(() => []);
  const mineUrls = new Set(mine.map((m) => m.url));

  const theirs: Candidate[] = known
    .filter((p) => p.url && p.title && !mineUrls.has(p.url) && p.url !== excludeUrl)
    .map((p, i) => ({
      id: `s:${i}`,
      title: p.title,
      url: p.url,
      kind: 'site' as const,
      type: classifySitePage(p.url),
      inbound: 0,
      source: p.source,
    }))
    // type === '' => istenmeyen (case study, arsiv) -> at
    .filter((c) => c.type !== '');

  // Kendi yazilarimiz once (link grafigini biz yonetiyoruz), sonra site sayfalari.
  // Her iki grupta da az link alan one alinir.
  const sorted = [
    ...mine.sort((a, b) => a.inbound - b.inbound),
    ...theirs.slice(0, 120),
  ];

  return sorted.slice(0, limit);
}

/* -------------------------------------------------------------- yerlestirme */

const SKIP_PARENTS = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'th', 'code', 'pre']);

/** Turkce duyarli, buyuk/kucuk harf gozetmeyen konum bulma. */
function findIndex(haystack: string, needle: string): number {
  return haystack.toLocaleLowerCase('tr-TR').indexOf(needle.toLocaleLowerCase('tr-TR'));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Govdeden site-ici <a> linklerini soker (bagli metni korur).
 * Interlink her calistiginda once eski ic linkler temizlenir; boylece
 * tekrar calistirmak idempotent olur ve eski hatali linkler silinir.
 * (Taslak asamasinda govdede zaten link olmaz; orada etkisizdir.)
 */
export function stripInternalLinks(html: string, siteUrl: string): string {
  const host = (() => {
    try {
      return new URL(siteUrl).host.toLowerCase();
    } catch {
      return '';
    }
  })();
  const $ = cheerio.load(html || '', null, false);
  $('a').each((_, el) => {
    const $a = $(el);
    const href = ($a.attr('href') || '').toLowerCase();
    const internal = !href || href.startsWith('/') || href.startsWith('#') || (!!host && href.includes(host));
    if (internal) $a.replaceWith($a.html() ?? $a.text());
  });
  return $.html();
}

/**
 * Secilen bagliyi govdede bulup <a> ile sarar.
 *
 * Yerlestirmeyi model degil kod yapar:
 *  - bagli metinde birebir gecmiyorsa link atilmaz (uydurma bagli engellenir)
 *  - baslik, tablo basligi ve mevcut link icine link konmaz
 *  - ayni paragrafta ikinci link acilmaz
 *  - ayni hedefe iki kez link verilmez
 */
export function insertLinks(
  html: string,
  choices: { anchor: string; url: string; targetId: string }[],
): { html: string; inserted: InterlinkResult['inserted']; skipped: InterlinkResult['skipped'] } {
  const $ = cheerio.load(html || '', null, false);

  const inserted: InterlinkResult['inserted'] = [];
  const skipped: InterlinkResult['skipped'] = [];
  const usedTargets = new Set<string>();
  const usedBlocks = new Set<AnyNode>();

  for (const choice of choices) {
    const anchor = choice.anchor.trim();

    if (anchor.length < 3) {
      skipped.push({ anchor, reason: 'bağlı metin çok kısa' });
      continue;
    }
    if (usedTargets.has(choice.targetId)) {
      skipped.push({ anchor, reason: 'bu hedefe zaten link verildi' });
      continue;
    }

    let done = false;

    // Yalnizca paragraf ve liste ogesi icindeki metin dugumleri
    $('p, li').each((_, block) => {
      if (done) return;
      if (usedBlocks.has(block)) return;

      const $block = $(block);
      if ($block.parents('a').length) return;

      $block
        .contents()
        .filter((_i, n) => n.type === 'text')
        .each((_i, node) => {
          if (done) return;

          const parentTag = (node.parent as { tagName?: string } | null)?.tagName?.toLowerCase();
          if (parentTag && SKIP_PARENTS.has(parentTag)) return;
          if ($(node).parents('a').length) return;

          const text = (node as unknown as { data: string }).data ?? '';
          const at = findIndex(text, anchor);
          if (at === -1) return;

          const before = text.slice(0, at);
          const match = text.slice(at, at + anchor.length);
          const after = text.slice(at + anchor.length);

          $(node).replaceWith(
            `${escapeHtml(before)}<a href="${choice.url}">${escapeHtml(match)}</a>${escapeHtml(after)}`,
          );

          usedTargets.add(choice.targetId);
          usedBlocks.add(block);
          inserted.push({ anchor: match, targetId: choice.targetId, url: choice.url });
          done = true;
        });
    });

    if (!done) skipped.push({ anchor, reason: 'metinde birebir bulunamadı' });
  }

  return { html: $.html(), inserted, skipped };
}

/* -------------------------------------------------------------------- adim */

/**
 * Yazi govdesine gercek ic link yerlestirir.
 *
 * Kalite dongusunden SONRA calisir; cunku duzeltme turu govdeyi yeniden yazar
 * ve daha once konmus linkleri kaybettirebilir.
 */
export async function interlinkArticle(articleId: string): Promise<InterlinkResult> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true },
  });
  const site = article.site;

  const empty: InterlinkResult = { inserted: [], skipped: [], candidates: 0 };

  if (!site.interlink || !article.contentHtml) return empty;

  // Once eski site-ici linkleri sok: tekrar calistirmada birikmesin,
  // eski hatali linkler temizlensin. Yeni linkler bu temiz govdeye konur.
  const cleanBody = stripInternalLinks(article.contentHtml, site.url);

  const candidates = await buildIndex(
    site.id,
    article.locale,
    article.id,
    article.remoteUrl,
  );
  // Aday yoksa bile temizlenmis govdeyi kaydet (eski kotu linkler gitsin)
  if (candidates.length === 0) {
    if (cleanBody !== article.contentHtml) {
      await prisma.article.update({ where: { id: articleId }, data: { contentHtml: cleanBody } });
      await prisma.internalLink.deleteMany({ where: { fromArticleId: articleId } });
    }
    return empty;
  }

  return runStep(
    { articleId, siteId: site.id, kind: 'interlink', step: article.locale },
    async () => {
      const { provider, model } = await getTextProvider({
        credentialId: site.preferredTextCredentialId,
        model: site.textModel,
      });

      const res = await provider.complete({
        system:
          'Sen bir içerik editörüsün. Bir yazının gövdesine, aynı sitedeki diğer yazılara ' +
          'giden iç linkler seçersin. Yalnızca gerçekten ilgili olanları seçersin.',
        prompt: pickPrompt(article.title, cleanBody, candidates, article.locale),
        model,
        json: true,
        maxTokens: 2000,
        temperature: 0.3,
      });

      const parsed = parseJson<{ links: Choice[] }>(res.text);
      const byId = new Map(candidates.map((c) => [c.id, c]));

      const choices = (parsed.links ?? [])
        .filter((l) => l.anchor && byId.has(l.targetId))
        .slice(0, CONTENT.internalLinks.max)
        .map((l) => ({
          anchor: l.anchor,
          targetId: l.targetId,
          url: byId.get(l.targetId)!.url,
        }));

      const { html, inserted, skipped } = insertLinks(cleanBody, choices);

      // Govde degistiyse kaydet: yeni link eklendiyse ya da eski linkler temizlendiyse
      if (inserted.length > 0 || html !== article.contentHtml) {
        await prisma.article.update({
          where: { id: articleId },
          data: { contentHtml: html },
        });

        // Link grafigini tazele
        await prisma.internalLink.deleteMany({ where: { fromArticleId: articleId } });
        for (const l of inserted) {
          const c = byId.get(l.targetId);
          await prisma.internalLink.create({
            data: {
              fromArticleId: articleId,
              // Sitenin mevcut sayfasina gidiyorsa yazi bagi yok
              toArticleId: c?.kind === 'article' ? (c.articleId as string) : null,
              anchor: l.anchor,
              targetUrl: l.url,
              targetTitle: c?.title ?? null,
              external: c?.kind !== 'article',
            },
          });
        }
      }

      return {
        result: { inserted, skipped, candidates: candidates.length },
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
        message:
          `${inserted.length} link yerleştirildi` +
          (skipped.length ? ` · ${skipped.length} atlandı` : '') +
          ` · ${candidates.filter((c) => c.kind === 'article').length} yazı + ` +
          `${candidates.filter((c) => c.kind === 'site').length} site sayfası aday`,
      };
    },
  );
}

function pickPrompt(
  title: string,
  contentHtml: string,
  candidates: Candidate[],
  locale: string,
): string {
  const plain = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);

  return `Bu yazının gövdesine ${CONTENT.internalLinks.min}-${CONTENT.internalLinks.max} adet iç link seç.
Dil: ${localeName(locale)}.

YAZI BAŞLIĞI: ${title}

YAZININ METNİ:
${plain}

LİNK VERİLEBİLECEK HEDEFLER (her birinin TÜRÜ belirtildi):
${candidates
  .map(
    (c, i) =>
      `${i + 1}. id=${c.id} · tür: ${c.type}\n   başlık: ${c.title}` +
      (c.focusKeyword ? `\n   odak kelime: ${c.focusKeyword}` : '') +
      `\n   şu an aldığı iç link: ${c.inbound}`,
  )
  .join('\n')}

KURALLAR (çok önemli):
- ALAKA ŞART. Bir hedefe link vermek için, bağlı metnin geçtiği CÜMLE ile hedefin
  başlığı AYNI konudan bahsetmeli. En ufak şüphede link verme. Alakasız link, hiç
  link vermemekten kötüdür.
- Öncelik sırası: (1) tür=yazı olan gerçekten ilgili yazılar, (2) metinde açıkça söz
  edilen tür=ürün / tür=hizmet / tür=iletişim sayfaları. Yazı yoksa zorla site sayfası
  bağlama.
- Ürün/hizmet/iletişim sayfasına SADECE metin o ürün/hizmetten ya da iletişime geçmekten
  gerçekten söz ediyorsa link ver. "POS cihazı" genel geçtiği için rastgele bir hizmet
  sayfasına bağlama; başlığı konuyla birebir örtüşmeli.
- "anchor" alanı, YUKARIDAKİ METİNDE BİREBİR GEÇEN bir ifade olmalı (kelimesi kelimesine).
  Bağlı metin 3-6 kelime, doğal bir isim tamlaması olsun ve hedefin konusunu anlatsın.
  "buraya tıklayın", "bu yazı" gibi genel ifadeler kullanma.
- ${CONTENT.internalLinks.min}-${CONTENT.internalLinks.max} arası uygun hedef bulamazsan
  DAHA AZ seç; hiç uygun yoksa boş dizi döndür. Sayıyı doldurmak için uydurma link kurma.
- Eşit derecede ilgiliyse az iç link alan hedefi tercih et.
- Aynı hedefe birden fazla link verme.
- Başlıklardan (H2/H3) ifade seçme; yalnızca paragraf ve liste metinlerinden seç.

Şu JSON şemasında yanıt ver:
{
  "links": [
    { "anchor": "metinde birebir geçen ifade", "targetId": "yukarıdaki id", "reason": "neden ilgili" }
  ]
}`;
}
