import * as cheerio from 'cheerio';
import { prisma } from '@/lib/db';
import { getPublishAdapter } from '@/lib/providers/publish';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { runStep } from './log';

/* ------------------------------------------------------------------ tipler */

export type AuditArea = 'indeksleme' | 'teknik' | 'meta' | 'içerik' | 'yapısal veri';

export type AuditFinding = {
  level: 'error' | 'warn' | 'ok';
  area: AuditArea;
  code: string;
  label: string;
  detail: string;
  /** Kullaniciya nasil duzeltecegini soyleyen kisa talimat */
  howTo?: string;
};

export type AuditSection = { area: AuditArea; score: number; max: number };

export type AuditResult = {
  score: number;
  sections: AuditSection[];
  findings: AuditFinding[];
  raw: Record<string, unknown>;
  actionPlan: { priority: 'yüksek' | 'orta' | 'düşük'; title: string; why: string; how: string }[];
  deep: boolean;
};

const WEIGHTS: Record<AuditArea, number> = {
  indeksleme: 25,
  teknik: 20,
  meta: 25,
  içerik: 20,
  'yapısal veri': 10,
};

/* ------------------------------------------------------------------ sonda */

type Probe = {
  robots: { ok: boolean; status: number; blocksAll: boolean; hasSitemap: boolean; body: string };
  sitemap: { url: string | null; ok: boolean; status: number; entries: number };
  home: {
    ok: boolean;
    status: number;
    ms: number;
    title: string;
    titleLen: number;
    description: string;
    descriptionLen: number;
    canonical: string;
    lang: string;
    viewport: boolean;
    h1Count: number;
    ogTags: number;
    jsonLdTypes: string[];
    hreflang: number;
  };
};

async function fetchText(url: string, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'DPDAI-SEO-Audit/1.0 (+blog otomasyon)' },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, body: '', ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/** Panel tarafindan, eklentiye ihtiyac duymadan yapilan dis kontroller. */
async function probeSite(baseUrl: string, sitemapCandidates: string[]): Promise<Probe> {
  const base = baseUrl.replace(/\/+$/, '');

  const [robotsRes, homeRes] = await Promise.all([
    fetchText(`${base}/robots.txt`),
    fetchText(base),
  ]);

  // --- robots.txt
  const robotsBody = robotsRes.body.slice(0, 8000);
  const blocksAll = /^\s*Disallow:\s*\/\s*$/im.test(robotsBody);
  const hasSitemapLine = /^\s*Sitemap:\s*http/im.test(robotsBody);

  // --- sitemap
  const candidates = sitemapCandidates.length
    ? sitemapCandidates
    : [`${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`, `${base}/sitemap.xml`];

  let sitemap: Probe['sitemap'] = { url: null, ok: false, status: 0, entries: 0 };
  for (const url of candidates) {
    const r = await fetchText(url);
    if (r.ok && /<(urlset|sitemapindex)/i.test(r.body)) {
      sitemap = {
        url,
        ok: true,
        status: r.status,
        entries: (r.body.match(/<loc>/gi) ?? []).length,
      };
      break;
    }
    if (!sitemap.status) sitemap = { url, ok: false, status: r.status, entries: 0 };
  }

  // --- ana sayfa
  let home: Probe['home'] = {
    ok: homeRes.ok,
    status: homeRes.status,
    ms: homeRes.ms,
    title: '',
    titleLen: 0,
    description: '',
    descriptionLen: 0,
    canonical: '',
    lang: '',
    viewport: false,
    h1Count: 0,
    ogTags: 0,
    jsonLdTypes: [],
    hreflang: 0,
  };

  if (homeRes.ok && homeRes.body) {
    const $ = cheerio.load(homeRes.body);
    const title = $('title').first().text().trim();
    const desc = ($('meta[name="description"]').attr('content') ?? '').trim();

    const jsonLdTypes: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).contents().text());
        const collect = (node: unknown) => {
          if (Array.isArray(node)) return node.forEach(collect);
          if (node && typeof node === 'object') {
            const t = (node as Record<string, unknown>)['@type'];
            if (typeof t === 'string') jsonLdTypes.push(t);
            if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && jsonLdTypes.push(x));
            const graph = (node as Record<string, unknown>)['@graph'];
            if (graph) collect(graph);
          }
        };
        collect(parsed);
      } catch {
        /* bozuk JSON-LD */
      }
    });

    home = {
      ...home,
      title,
      titleLen: title.length,
      description: desc,
      descriptionLen: desc.length,
      canonical: $('link[rel="canonical"]').attr('href') ?? '',
      lang: $('html').attr('lang') ?? '',
      viewport: $('meta[name="viewport"]').length > 0,
      h1Count: $('h1').length,
      ogTags: $('meta[property^="og:"]').length,
      jsonLdTypes: [...new Set(jsonLdTypes)],
      hreflang: $('link[rel="alternate"][hreflang]').length,
    };
  }

  return {
    robots: {
      ok: robotsRes.ok,
      status: robotsRes.status,
      blocksAll,
      hasSitemap: hasSitemapLine,
      body: robotsBody.slice(0, 2000),
    },
    sitemap,
    home,
  };
}

/* ------------------------------------------------------------------ denetim */

type BridgeAudit = {
  platform?: Record<string, unknown>;
  indexing?: Record<string, unknown>;
  technical?: Record<string, unknown>;
  seoPlugin?: { name?: string; settings?: Record<string, unknown> };
  content?: Record<string, number | string | null>;
  taxonomy?: Record<string, number>;
  media?: Record<string, number>;
};

export async function runSiteAudit(siteId: string): Promise<AuditResult> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });

  return runStep({ siteId, kind: 'audit', step: 'site' }, async () => {
    // --- 1. derin veri (eklenti varsa)
    let bridge: BridgeAudit | null = null;
    if (site.platform === 'WORDPRESS' && site.hasBridge) {
      const adapter = getPublishAdapter(site);
      if (adapter.seoAudit) {
        bridge = (await adapter.seoAudit().catch(() => null)) as BridgeAudit | null;
      }
    }

    // --- 2. dis sondalar (her zaman)
    const sitemapCandidates =
      (bridge?.indexing?.sitemap_urls as string[] | undefined) ?? [];
    const probe = await probeSite(site.url, sitemapCandidates);

    // --- 3. bulgular
    const findings: AuditFinding[] = [];
    const penalty: Record<AuditArea, number> = {
      indeksleme: 0,
      teknik: 0,
      meta: 0,
      içerik: 0,
      'yapısal veri': 0,
    };

    const add = (
      level: AuditFinding['level'],
      area: AuditArea,
      code: string,
      label: string,
      detail: string,
      cost = 0,
      howTo?: string,
    ) => {
      findings.push({ level, area, code, label, detail, howTo });
      if (level !== 'ok') penalty[area] += cost;
    };

    collectIndexing(add, probe, bridge, site.url);
    collectTechnical(add, probe, bridge);
    collectMeta(add, probe, bridge);
    collectContent(add, bridge);
    collectStructuredData(add, probe, bridge);

    const sections: AuditSection[] = (Object.keys(WEIGHTS) as AuditArea[]).map((area) => ({
      area,
      score: Math.round(WEIGHTS[area] - Math.min(WEIGHTS[area], penalty[area])),
      max: WEIGHTS[area],
    }));
    const score = Math.max(0, Math.min(100, sections.reduce((s, a) => s + a.score, 0)));

    // --- 4. AI eylem plani
    const actionPlan = await buildActionPlan(site, findings, score).catch(() => []);

    const result: AuditResult = {
      score,
      sections,
      findings,
      raw: { bridge, probe } as unknown as Record<string, unknown>,
      actionPlan,
      deep: bridge !== null,
    };

    await prisma.seoAudit.create({
      data: {
        siteId,
        score,
        sections: sections as unknown as object,
        findings: findings as unknown as object,
        raw: result.raw as unknown as object,
        actionPlan: actionPlan as unknown as object,
      },
    });

    return {
      result,
      message: `${score}/100 · ${findings.filter((f) => f.level !== 'ok').length} bulgu · ${
        bridge ? 'derin tarama' : 'yüzeysel tarama'
      }`,
    };
  });
}

/* ------------------------------------------------------------------ alanlar */

type Add = (
  level: AuditFinding['level'],
  area: AuditArea,
  code: string,
  label: string,
  detail: string,
  cost?: number,
  howTo?: string,
) => void;

function collectIndexing(add: Add, probe: Probe, bridge: BridgeAudit | null, siteUrl: string) {
  // arama motoru gorunurlugu
  const blogPublic = bridge?.indexing?.blog_public;
  if (blogPublic === 0) {
    add('error', 'indeksleme', 'blogPublic', 'Site arama motorlarına kapalı',
      'Ayarlar > Okuma > "Arama motorlarını bu siteyi indekslemekten caydır" işaretli.', 25,
      'WordPress yönetiminde Ayarlar > Okuma bölümünden bu kutunun işaretini kaldırın.');
  } else if (blogPublic === 1) {
    add('ok', 'indeksleme', 'blogPublic', 'Site indekslenebilir', 'Arama motoru görünürlüğü açık.');
  }

  // robots.txt
  if (!probe.robots.ok) {
    add('warn', 'indeksleme', 'robots', 'robots.txt okunamadı',
      `HTTP ${probe.robots.status}.`, 3,
      'Sunucunun /robots.txt adresine yanıt verdiğinden emin olun.');
  } else if (probe.robots.blocksAll) {
    add('error', 'indeksleme', 'robotsBlock', 'robots.txt tüm siteyi engelliyor',
      '"Disallow: /" satırı bulundu.', 20,
      'robots.txt içindeki "Disallow: /" satırını kaldırın.');
  } else {
    add('ok', 'indeksleme', 'robots', 'robots.txt uygun', `HTTP ${probe.robots.status}.`);
  }

  // sitemap
  if (!probe.sitemap.ok) {
    add('error', 'indeksleme', 'sitemap', 'Site haritası bulunamadı',
      probe.sitemap.url
        ? `${probe.sitemap.url} adresinden geçerli XML alınamadı (HTTP ${probe.sitemap.status}).`
        : 'Denenen adreslerde site haritası yok.', 10,
      'Yoast/Rank Math site haritasını açın veya WordPress çekirdek haritasını (wp-sitemap.xml) etkinleştirin.');
  } else {
    add('ok', 'indeksleme', 'sitemap', 'Site haritası çalışıyor',
      `${probe.sitemap.entries} bağlantı · ${probe.sitemap.url}`);
    if (!probe.robots.hasSitemap) {
      add('warn', 'indeksleme', 'robotsSitemap', 'robots.txt site haritasını bildirmiyor',
        'robots.txt içinde "Sitemap:" satırı yok.', 3,
        `robots.txt sonuna "Sitemap: ${probe.sitemap.url}" satırını ekleyin.`);
    }
  }

  // kalici baglanti yapisi
  const permalink = bridge?.indexing?.permalink as string | undefined;
  if (permalink !== undefined) {
    if (!permalink || permalink.includes('?p=') || /%post_id%/.test(permalink)) {
      add('error', 'indeksleme', 'permalink', 'Kalıcı bağlantı yapısı SEO uyumsuz',
        `Mevcut yapı: ${permalink || '(sade / varsayılan)'}`, 12,
        'Ayarlar > Kalıcı Bağlantılar bölümünden "Yazı adı" (/%postname%/) seçin.');
    } else if (/%year%|%monthnum%|%day%/.test(permalink)) {
      add('warn', 'indeksleme', 'permalink', 'Kalıcı bağlantıda tarih var',
        `Mevcut yapı: ${permalink}`, 3,
        'Tarihsiz yapı (/%postname%/) içeriğin eskimiş görünmesini engeller. Değiştirirseniz mutlaka 301 yönlendirme kurun.');
    } else {
      add('ok', 'indeksleme', 'permalink', 'Kalıcı bağlantı yapısı uygun', permalink);
    }
  }

  // https
  if (!siteUrl.startsWith('https://')) {
    add('error', 'indeksleme', 'https', 'Site HTTPS kullanmıyor', siteUrl, 10,
      'SSL sertifikası kurun ve site adresini https:// olarak güncelleyin.');
  }
}

function collectTechnical(add: Add, probe: Probe, bridge: BridgeAudit | null) {
  if (!probe.home.ok) {
    add('error', 'teknik', 'homeDown', 'Ana sayfa yüklenemedi',
      `HTTP ${probe.home.status}.`, 20,
      'Sitenin dışarıdan erişilebilir olduğunu ve güvenlik duvarının botu engellemediğini kontrol edin.');
    return;
  }

  if (probe.home.ms > 2500) {
    add('warn', 'teknik', 'ttfb', 'Ana sayfa yavaş',
      `Yanıt süresi ${probe.home.ms} ms.`, 5,
      'Önbellek eklentisi kurun, görselleri sıkıştırın, sunucu planını gözden geçirin.');
  } else {
    add('ok', 'teknik', 'ttfb', 'Yanıt süresi iyi', `${probe.home.ms} ms.`);
  }

  if (!probe.home.viewport) {
    add('error', 'teknik', 'viewport', 'Mobil viewport etiketi yok',
      'Tema <meta name="viewport"> basmıyor.', 8,
      'Temanın header dosyasına viewport meta etiketi ekleyin veya güncel bir tema kullanın.');
  }

  if (!probe.home.lang) {
    add('warn', 'teknik', 'lang', 'html lang özniteliği yok', 'Sayfa dili bildirilmemiş.', 3,
      'Temanın <html> etiketine language_attributes() ekleyin.');
  }

  const t = bridge?.technical;
  if (t) {
    if (!t.has_cache_plugin) {
      add('warn', 'teknik', 'cache', 'Önbellek eklentisi yok',
        'Sayfa önbelleği tespit edilmedi.', 4,
        'WP Rocket, LiteSpeed Cache veya WP Super Cache gibi bir önbellek eklentisi kurun.');
    } else {
      add('ok', 'teknik', 'cache', 'Önbellek eklentisi var', String(t.has_cache_plugin));
    }
    if (t.debug_on) {
      add('warn', 'teknik', 'debug', 'WP_DEBUG açık',
        'Canlı sitede hata ayıklama açık olmamalı.', 4,
        'wp-config.php içinde WP_DEBUG değerini false yapın.');
    }
    if ((t.active_plugins as number) > 30) {
      add('warn', 'teknik', 'plugins', 'Çok fazla eklenti',
        `${t.active_plugins} etkin eklenti.`, 2,
        'Kullanılmayan eklentileri kaldırın; her eklenti yükleme süresine eklenir.');
    }
  }

  const p = bridge?.platform;
  if (p && typeof p.php_version === 'string' && parseFloat(p.php_version) < 8.1) {
    add('warn', 'teknik', 'php', 'PHP sürümü eski',
      `PHP ${p.php_version}.`, 3, 'Hosting panelinden PHP 8.2+ sürümüne geçin.');
  }
}

function collectMeta(add: Add, probe: Probe, bridge: BridgeAudit | null) {
  const h = probe.home;

  if (!h.title) {
    add('error', 'meta', 'homeTitle', 'Ana sayfa başlığı yok', '<title> boş.', 10,
      'SEO eklentisinden ana sayfa başlık şablonunu tanımlayın.');
  } else if (h.titleLen > 65 || h.titleLen < 20) {
    add('warn', 'meta', 'homeTitle', 'Ana sayfa başlık uzunluğu',
      `${h.titleLen} karakter: "${h.title.slice(0, 80)}"`, 3,
      'Ana sayfa başlığını 30-60 karakter arasına getirin.');
  } else {
    add('ok', 'meta', 'homeTitle', 'Ana sayfa başlığı uygun', `${h.titleLen} karakter.`);
  }

  if (!h.description) {
    add('error', 'meta', 'homeDesc', 'Ana sayfa meta açıklaması yok', '', 8,
      'SEO eklentisinden ana sayfa meta açıklamasını yazın.');
  } else if (h.descriptionLen < 100 || h.descriptionLen > 170) {
    add('warn', 'meta', 'homeDesc', 'Ana sayfa açıklama uzunluğu',
      `${h.descriptionLen} karakter.`, 2, 'Açıklamayı 130-158 karakter arasına getirin.');
  } else {
    add('ok', 'meta', 'homeDesc', 'Ana sayfa açıklaması uygun', `${h.descriptionLen} karakter.`);
  }

  if (!h.canonical) {
    add('warn', 'meta', 'canonical', 'Canonical etiketi yok',
      'Ana sayfada rel=canonical bulunamadı.', 4,
      'SEO eklentisi canonical basmalı; kurulu değilse dpdai-bridge bunu üstlenir.');
  }

  if (h.h1Count === 0) {
    add('warn', 'meta', 'h1', 'Ana sayfada H1 yok', '', 3, 'Temanın ana sayfada tek bir H1 basmasını sağlayın.');
  } else if (h.h1Count > 1) {
    add('warn', 'meta', 'h1', 'Ana sayfada birden fazla H1', `${h.h1Count} adet.`, 3,
      'Sayfa başına tek H1 kullanın.');
  }

  if (h.ogTags < 3) {
    add('warn', 'meta', 'og', 'Open Graph etiketleri eksik',
      `${h.ogTags} og: etiketi bulundu.`, 3,
      'Sosyal paylaşımda önizleme için og:title, og:description ve og:image gerekir.');
  }

  // yazi bazli eksikler
  const c = bridge?.content;
  if (c) {
    const published = Number(c.published ?? 0);
    const noTitle = Number(c.missing_meta_title ?? 0);
    const noDesc = Number(c.missing_meta_desc ?? 0);

    if (published > 0 && noDesc / published > 0.3) {
      add('error', 'meta', 'postDesc', 'Yazıların çoğunda meta açıklama yok',
        `${noDesc} / ${published} yazı.`, 8,
        'Panelden üretilen yeni yazılarda otomatik doluyor; eski yazılar için toplu düzenleme yapın.');
    } else if (noDesc > 0) {
      add('warn', 'meta', 'postDesc', 'Bazı yazılarda meta açıklama yok',
        `${noDesc} / ${published} yazı.`, 3);
    } else if (published > 0) {
      add('ok', 'meta', 'postDesc', 'Tüm yazılarda meta açıklama var', `${published} yazı.`);
    }

    if (noTitle > 0) {
      add('warn', 'meta', 'postTitle', 'Bazı yazılarda SEO başlığı yok',
        `${noTitle} / ${published} yazı.`, 3,
        'SEO başlığı boşsa eklenti şablonu kullanır; kritik yazılarda elle yazın.');
    }
  }

  // arsiv indeksleme ayarlari
  const sp = bridge?.seoPlugin?.settings;
  if (sp) {
    if (sp.noindex_tag === false) {
      add('warn', 'meta', 'tagIndex', 'Etiket arşivleri indeksleniyor',
        'İnce etiket arşivleri kopya içerik riski oluşturur.', 3,
        'SEO eklentisinde etiket arşivlerini noindex yapın.');
    }
    if (sp.noindex_date === false) {
      add('warn', 'meta', 'dateIndex', 'Tarih arşivleri indeksleniyor', '', 2,
        'SEO eklentisinde tarih arşivlerini kapatın.');
    }
    if (sp.attachment_redirect === false) {
      add('warn', 'meta', 'attachment', 'Ek dosya sayfaları açık',
        'Görsel ek sayfaları ince içerik üretir.', 3,
        'SEO eklentisinde ek dosya URL\'lerini yazıya yönlendirin.');
    }
  }
}

function collectContent(add: Add, bridge: BridgeAudit | null) {
  const c = bridge?.content;
  if (!c) {
    add('warn', 'içerik', 'noBridge', 'İçerik taraması yapılamadı',
      'Derin tarama için dpdai-bridge eklentisi gerekir.', 6,
      'Siteye dpdai-bridge eklentisini kurun; ince içerik, eksik görsel ve kopya başlık taraması açılır.');
    return;
  }

  const published = Number(c.published ?? 0);
  if (published === 0) {
    add('warn', 'içerik', 'empty', 'Yayınlanmış yazı yok', '', 8);
    return;
  }

  const thin = Number(c.thin_posts ?? 0);
  if (thin / published > 0.25) {
    add('error', 'içerik', 'thin', 'İnce içerik oranı yüksek',
      `${thin} / ${published} yazı 300 kelimenin altında.`, 8,
      'Kısa yazıları genişletin veya birleştirin; kalıcı değeri olmayanları kaldırıp 301 yönlendirin.');
  } else if (thin > 0) {
    add('warn', 'içerik', 'thin', 'İnce içerik var', `${thin} / ${published} yazı.`, 3,
      'Bu yazıları genişletmek arama görünürlüğünü artırır.');
  } else {
    add('ok', 'içerik', 'thin', 'İnce içerik yok', `${published} yazı.`);
  }

  const noThumb = Number(c.missing_thumbnail ?? 0);
  if (noThumb / published > 0.2) {
    add('warn', 'içerik', 'thumb', 'Öne çıkan görseli olmayan yazılar',
      `${noThumb} / ${published} yazı.`, 4,
      'Sosyal paylaşım ve liste görünümü için her yazıya öne çıkan görsel ekleyin.');
  }

  const dup = Number(c.duplicate_titles ?? 0);
  if (dup > 0) {
    add('warn', 'içerik', 'dupTitle', 'Yinelenen başlıklar',
      `${dup} başlık birden fazla yazıda kullanılmış.`, 4,
      'Aynı başlıklı yazıları birleştirin veya başlıkları farklılaştırın (yamyamlaşma riski).');
  }

  const stale = Number(c.stale_posts ?? 0);
  if (published > 10 && stale / published > 0.5) {
    add('warn', 'içerik', 'stale', 'İçeriğin çoğu 2 yıldır güncellenmemiş',
      `${stale} / ${published} yazı.`, 3,
      'En çok trafik alan eski yazıları güncelleyip tarihini tazeleyin.');
  }

  const lastPublished = c.last_published ? new Date(String(c.last_published)) : null;
  if (lastPublished) {
    const days = Math.round((Date.now() - lastPublished.getTime()) / 86_400_000);
    if (days > 60) {
      add('warn', 'içerik', 'cadence', 'Uzun süredir yeni yazı yok',
        `Son yayın ${days} gün önce.`, 3,
        'Konu havuzuna başlık ekleyip yayın takvimini çalıştırın.');
    } else {
      add('ok', 'içerik', 'cadence', 'Yayın düzeni aktif', `Son yayın ${days} gün önce.`);
    }
  }

  const tx = bridge?.taxonomy;
  if (tx) {
    if (Number(tx.uncategorized_posts ?? 0) > 0) {
      add('warn', 'içerik', 'uncategorized', 'Kategorisiz yazılar',
        `${tx.uncategorized_posts} yazı varsayılan kategoride.`, 2,
        'Yazıları anlamlı kategorilere taşıyın.');
    }
    if (Number(tx.categories_no_desc ?? 0) > 0) {
      add('warn', 'içerik', 'catDesc', 'Açıklamasız kategoriler',
        `${tx.categories_no_desc} / ${tx.categories} kategori.`, 2,
        'Kategori arşivlerine 2-3 cümlelik açıklama ekleyin.');
    }
    if (Number(tx.tags ?? 0) > Number(tx.categories ?? 0) * 20) {
      add('warn', 'içerik', 'tagBloat', 'Aşırı etiket kullanımı',
        `${tx.tags} etiket.`, 2, 'Az kullanılan etiketleri birleştirin veya silin.');
    }
  }

  const m = bridge?.media;
  if (m && Number(m.images ?? 0) > 0) {
    const ratio = Number(m.images_no_alt ?? 0) / Number(m.images);
    if (ratio > 0.3) {
      add('warn', 'içerik', 'alt', 'Görsellerin çoğunda alt metni yok',
        `${m.images_no_alt} / ${m.images} görsel.`, 4,
        'Alt metni hem erişilebilirlik hem görsel araması için gerekli.');
    } else {
      add('ok', 'içerik', 'alt', 'Görsel alt metinleri yeterli',
        `${Number(m.images) - Number(m.images_no_alt)} / ${m.images}.`);
    }
  }
}

function collectStructuredData(add: Add, probe: Probe, bridge: BridgeAudit | null) {
  const types = probe.home.jsonLdTypes;

  if (types.length === 0) {
    add('error', 'yapısal veri', 'jsonld', 'JSON-LD yapısal veri yok',
      'Ana sayfada schema.org işaretlemesi bulunamadı.', 8,
      'SEO eklentisinin şema modülünü açın; kurulu değilse dpdai-bridge yazılarda BlogPosting/FAQPage basar.');
  } else {
    add('ok', 'yapısal veri', 'jsonld', 'Yapısal veri bulundu', types.join(', '));

    const hasOrg = types.some((t) => /Organization|LocalBusiness|Person/i.test(t));
    if (!hasOrg) {
      add('warn', 'yapısal veri', 'org', 'Kurum/kişi şeması yok',
        'Organization veya Person şeması bilgi paneli için gerekir.', 3,
        'SEO eklentisinde site temsilcisini (kurum veya kişi) ve logoyu tanımlayın.');
    }
    const hasWebsite = types.some((t) => /WebSite/i.test(t));
    if (!hasWebsite) {
      add('warn', 'yapısal veri', 'website', 'WebSite şeması yok', '', 2,
        'WebSite şeması site içi arama kutusu özelliği için gerekir.');
    }
  }

  const sp = bridge?.seoPlugin?.settings;
  if (sp && sp.org_logo === false) {
    add('warn', 'yapısal veri', 'logo', 'Kurum logosu tanımlı değil', '', 2,
      'SEO eklentisinde kurum logosunu yükleyin.');
  }

  if (probe.home.hreflang === 0 && bridge?.indexing) {
    // cok dilli olup olmadigini bilmiyoruz; bilgi amacli
    add('ok', 'yapısal veri', 'hreflang', 'hreflang etiketi yok',
      'Tek dilli site için normal. Çok dilliyse Polylang/WPML ayarlarını kontrol edin.');
  }
}

/* --------------------------------------------------------------- eylem plani */

async function buildActionPlan(
  site: {
    preferredTextCredentialId: string | null;
    textModel: string | null;
    name: string;
    url: string;
  },
  findings: AuditFinding[],
  score: number,
): Promise<AuditResult['actionPlan']> {
  const problems = findings.filter((f) => f.level !== 'ok');
  if (problems.length === 0) return [];

  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });

  const res = await provider.complete({
    system:
      'Sen teknik SEO danışmanısın. Site sahibine, etkisi en yüksek işten başlayarak ' +
      'uygulanabilir bir yol haritası verirsin. Genel tavsiye değil, bu sitedeki somut bulgulara ' +
      'dayanan adımlar yazarsın.',
    prompt: `SİTE: ${site.name} (${site.url})
GENEL SEO PUANI: ${score}/100

TESPİT EDİLEN BULGULAR:
${problems
  .map((f) => `- [${f.level}] ${f.area} · ${f.label}: ${f.detail}${f.howTo ? ` (öneri: ${f.howTo})` : ''}`)
  .join('\n')}

Bu bulguları etki/emek dengesine göre önceliklendir ve en fazla 8 maddelik bir eylem planı yaz.
Aynı kökten gelen bulguları tek maddede birleştir.

Şu JSON şemasında yanıt ver:
{
  "plan": [
    { "priority": "yüksek|orta|düşük",
      "title": "kısa eylem başlığı",
      "why": "neden önemli, tek cümle",
      "how": "nasıl yapılır, WordPress'te nereye tıklanacağı dahil somut adım" }
  ]
}`,
    model,
    json: true,
    maxTokens: 3000,
    temperature: 0.3,
  });

  const parsed = parseJson<{ plan: AuditResult['actionPlan'] }>(res.text);
  return Array.isArray(parsed.plan) ? parsed.plan.slice(0, 8) : [];
}
