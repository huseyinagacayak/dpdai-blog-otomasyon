import * as cheerio from 'cheerio';
import { prisma } from '@/lib/db';
import { getPublishAdapter } from '@/lib/providers/publish';

/**
 * Sitenin MEVCUT sayfa dizini.
 *
 * Ic linkleme, biz daha hicbir sey yayinlamadan once de calisabilsin diye
 * sitenin kendi sayfalarini (urunler, kategoriler, kurumsal sayfalar, eski
 * yazilar) toplar. Iki kaynak kullanilir:
 *
 *   1. WordPress REST  - yazi ve sayfa basliklari, ucuz ve dogru
 *   2. sitemap.xml     - WordPress disi her sey (urun, ozel icerik turu)
 *
 * Sitemap yalnizca URL verir, baslik vermez. Slug'dan okunabilir bir etiket
 * turetilir; en onemli birkac sayfa icin gercek <title> cekilir.
 */

export type SitePage = {
  title: string;
  url: string;
  source: 'post' | 'page' | 'sitemap';
};

const UA = 'DPDAI-Blog-Otomasyon/1.0';

async function get(url: string, timeoutMs = 15_000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** <loc> degerlerini cikarir (sitemap index ya da urlset fark etmez). */
function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** URL sonundaki slug'i okunabilir bir etikete cevirir. */
export function labelFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const slug = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    if (!slug) return '';
    return slug
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/** Ilgisiz URL'leri eler (besleme, etiket arsivi, sayfalama, ek dosya). */
function isUseful(url: string, siteUrl: string): boolean {
  if (!url.startsWith(siteUrl.replace(/\/+$/, ''))) return false;

  const bad =
    /\/(feed|comments|wp-json|wp-content|wp-admin|cart|sepet|checkout|odeme|my-account|hesabim|search|arama)\b/i;
  if (bad.test(url)) return false;

  // sayfalama: /page/2/ veya ?page=2
  if (/\/page\/\d+/i.test(url) || /[?&]page=\d+/i.test(url)) return false;
  // dosya uzantilari
  if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(url)) return false;

  return true;
}

/** Sitemap zincirini gezer (index -> alt haritalar) ve URL toplar. */
export async function crawlSitemap(
  siteUrl: string,
  candidates: string[] = [],
  maxUrls = 400,
): Promise<string[]> {
  const base = siteUrl.replace(/\/+$/, '');
  const roots = candidates.length
    ? candidates
    : [`${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`, `${base}/sitemap.xml`];

  const seen = new Set<string>();
  const urls: string[] = [];
  const queue = [...roots];
  let fetched = 0;

  while (queue.length && urls.length < maxUrls && fetched < 15) {
    const sm = queue.shift() as string;
    if (seen.has(sm)) continue;
    seen.add(sm);

    const xml = await get(sm);
    fetched++;
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;

    const isIndex = /<sitemapindex/i.test(xml);
    for (const loc of extractLocs(xml)) {
      if (isIndex) {
        // Gorsel/video haritalarini atla
        if (/image|video|news/i.test(loc)) continue;
        queue.push(loc);
      } else if (isUseful(loc, base) && !urls.includes(loc)) {
        urls.push(loc);
        if (urls.length >= maxUrls) break;
      }
    }
  }

  return urls;
}

/** Verilen sayfalarin gercek <title> degerini ceker (sinirli, es zamanli). */
async function enrichTitles(
  urls: string[],
  limit: number,
  concurrency = 4,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = urls.slice(0, limit);

  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        const html = await get(url, 10_000);
        if (!html) return null;
        const $ = cheerio.load(html);
        // Once H1, yoksa <title> (title'da site adi eki olabilir)
        const h1 = $('h1').first().text().trim();
        const title = h1 || $('title').first().text().trim();
        return title ? ([url, title.slice(0, 200)] as const) : null;
      }),
    );
    for (const r of results) if (r) out.set(r[0], r[1]);
  }

  return out;
}

/**
 * Sitenin sayfa dizinini kurar ve Site.knownTitles alanina yazar.
 * Baglanti testinde ve gerektiginde (dizin bayatlayinca) cagrilir.
 */
export async function refreshSiteIndex(siteId: string): Promise<SitePage[]> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const base = site.url.replace(/\/+$/, '');
  const pages = new Map<string, SitePage>();

  // --- 1. WordPress REST: yazi ve sayfa basliklari (dogru baslik, ucuz)
  if (site.platform === 'WORDPRESS') {
    try {
      const adapter = getPublishAdapter(site);
      if (adapter.fetchPublishedTitles) {
        for (const p of await adapter.fetchPublishedTitles()) {
          pages.set(p.url, { title: p.title, url: p.url, source: p.source ?? 'post' });
        }
      }
    } catch {
      /* baglanti yoksa sitemap ile devam */
    }
  }

  // --- 2. sitemap.xml: urunler, ozel icerik turleri, WordPress disi sayfalar
  const caps = (site.capabilities ?? {}) as { indexing?: { sitemap_urls?: string[] } };
  const known = (caps.indexing?.sitemap_urls ?? []) as string[];
  const sitemapUrls = await crawlSitemap(base, known);

  const yeni = sitemapUrls.filter((u) => !pages.has(u));

  // Slug'dan etiket turet; en yeni 50 sayfa icin gercek basligi cek
  const titles = await enrichTitles(yeni, 50);
  for (const url of yeni) {
    const title = titles.get(url) ?? labelFromUrl(url);
    if (title && title.length > 2) {
      pages.set(url, { title, url, source: 'sitemap' });
    }
  }

  const list = [...pages.values()].slice(0, 400);

  await prisma.site.update({
    where: { id: siteId },
    data: { knownTitles: list as unknown as object, knownTitlesAt: new Date() },
  });

  return list;
}

/** Kayitli dizini okur; yoksa veya cok bayatsa yeniler. */
export async function getSiteIndex(siteId: string, maxAgeDays = 7): Promise<SitePage[]> {
  const site = await prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    select: { knownTitles: true, knownTitlesAt: true },
  });

  const stale =
    !site.knownTitlesAt ||
    Date.now() - site.knownTitlesAt.getTime() > maxAgeDays * 24 * 3600_000;

  if (!stale && Array.isArray(site.knownTitles)) {
    return site.knownTitles as unknown as SitePage[];
  }

  return refreshSiteIndex(siteId).catch(
    () => (site.knownTitles ?? []) as unknown as SitePage[],
  );
}
